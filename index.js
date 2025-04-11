import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";
import { fileURLToPath } from 'url';
import csv from 'csvtojson';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORICAL_DATA_FILE = path.join(__dirname, 'historical_bird_data.csv');

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: ""
});

// Configure CORS middleware
app.use(cors({
    origin: "http://localhost:3000",
    methods: ["POST", "GET", "OPTIONS"], // Include OPTIONS for preflight requests
    credentials: true, // Enable cookies/authorization headers
}));

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
        allowedTypes.includes(file.mimetype)
            ? cb(null, true)
            : cb(new Error("Invalid file type. Only JPG/PNG/WEBP allowed"));
    },
});

// In-memory cache for taxonomy data
let taxonomyCache = [];

// Function to load taxonomy data from file
const loadTaxonomyData = () => {
    const filePath = path.join(__dirname, 'taxonomyCache.json');
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            taxonomyCache = JSON.parse(data);
            console.log(`Loaded ${taxonomyCache.length} taxonomy entries from ${filePath}`);
        } else {
            console.warn(`Taxonomy cache file not found: ${filePath}`);
        }
    } catch (error) {
        console.error("Error loading taxonomy data:", error);
    }
};

// Function to get species code from the in-memory cache
const getSpeciesCode = (speciesName) => {
    const speciesEntry = taxonomyCache.find(entry =>
        entry.comName?.toLowerCase() === speciesName?.toLowerCase() ||
        entry.sciName?.toLowerCase() === speciesName?.toLowerCase()
    );
    return speciesEntry ? speciesEntry.speciesCode : null;
};

// Unsplash Image Service
const UNSPLASH_API_KEY = "5R_DESU0FUmqo_L5imHUDNpL7HuS31KhUVVEE1HkwFk";
const UNSPLASH_BASE_URL = 'https://api.unsplash.com/search/photos';

// Modify the fetchImages function to use more specific queries
async function fetchImages(query, perPage) {
    if (!UNSPLASH_API_KEY) throw new Error('Unsplash API key missing');

    try {
        const response = await axios.get(UNSPLASH_BASE_URL, {
            params: {
                query: `${query}`, // Removed redundant "bird" keyword
                per_page: perPage,
                client_id: UNSPLASH_API_KEY,
                orientation: 'landscape'
            },
        });

        return response.data.results.map((image) => image.urls.regular) || [];
    } catch (error) {
        console.error(`Image fetch error: ${error.message}`);
        return [];
    }
}

// Update getBirdAndNestImages to use both scientific and common names
async function getBirdAndNestImages(scientificName) {
    try {
        const searchQueries = {
            bird: ` ${scientificName}`,
            nest: `$nest ${scientificName} `
        };

        const [birdImages, nestImages] = await Promise.all([
            fetchImages(searchQueries.bird, 8),
            fetchImages(searchQueries.nest, 4),
        ]);

        // Fallback logic
        return {
            birdImages: birdImages.length > 0 ? birdImages : ['placeholder-bird.jpg'],
            nestImages: nestImages.length > 0 ? nestImages : ['placeholder-nest.jpg']
        };
    } catch (error) {
        console.error(`Image processing error: ${error.message}`);
        return { birdImages: [], nestImages: [] };
    }
}

// Load historical data from CSV file
async function loadHistoricalData(speciesCode) {
    try {
        if (!fs.existsSync(HISTORICAL_DATA_FILE)) {
            console.log('Historical data file does not exist. Creating it...');
            fs.writeFileSync(HISTORICAL_DATA_FILE, 'speciesCode,latitude,longitude,observationDate\n');
            return [];
        }

        const csvData = await csv().fromFile(HISTORICAL_DATA_FILE);
        return csvData
            .filter(row => row.speciesCode === speciesCode)
            .map(row => ({
                ds: row.observationDate, // Date
                y: parseFloat(row.latitude), // Latitude
                z: parseFloat(row.longitude)  // Longitude
            }));
    } catch (error) {
        console.error('Error loading historical data:', error);
        return [];
    }
}
// Updated train function
async function trainProphetModel(historicalData) {
    const model = new SimpleForecaster();
    
    if (historicalData && historicalData.length > 0) {
        model.train(historicalData);
    } else {
        console.warn("No historical data to train the model.");
        return null;
    }
    
    return model;
}

// Updated predict function
async function predictMigrationPath(model, periods) {
    if (!model) return [];
    return model.predict(periods);
}
// Add bird location to CSV
app.post("/add-bird-location", express.json(), async (req, res) => {
    const { species, latitude, longitude, observationDate } = req.body;

    if (!species || !latitude || !longitude || !observationDate) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        // Check if the species exists
        const speciesCode = getSpeciesCode(species);
        if (!speciesCode) {
            return res.status(404).json({ error: "Species not found." });
        }

        // Append the data to the CSV file
        const csvLine = `${speciesCode},${latitude},${longitude},${observationDate}\n`;
        fs.appendFile(HISTORICAL_DATA_FILE, csvLine, (err) => {
            if (err) {
                console.error("Failed to append to historical data file:", err);
                return res.status(500).json({ error: "Failed to save data." });
            }

            console.log(`Added bird location data for ${species}.`);
            res.json({ message: "Bird location data added successfully." });
        });
    } catch (error) {
        console.error("Error adding bird location:", error);
        res.status(500).json({ error: "Failed to add bird location." });
    }
});

// Predict migration path endpoint
app.get("/predict-migration", async (req, res) => {
    const { species, periods } = req.query; // Number of periods to forecast

    try {
        // 1. Get species code
        const speciesCode = getSpeciesCode(species);
        if (!speciesCode) {
            return res.status(404).json({ error: "Species not found." });
        }

        // 2. Load historical data
        const historicalData = await loadHistoricalData(speciesCode);
        if (!historicalData || historicalData.length === 0) {
            return res.status(404).json({ error: "No historical data found for this species." });
        }

        // 3. Train Prophet model
        const model = await trainProphetModel(historicalData);
        if (!model) {
            return res.status(500).json({ error: "Failed to train the model." });
        }

        // 4. Predict migration path
        const numPeriods = parseInt(periods) || 365;  // Default to 365 days if not provided
        const migrationPath = await predictMigrationPath(model, numPeriods);

        // 5. Return the predicted path
        res.json({ migrationPath });
    } catch (error) {
        console.error("Error predicting migration:", error);
        res.status(500).json({ error: "Failed to predict migration." });
    }
});

// Image classification endpoint with sound integration
app.post("/classify-bird", upload.single("image"), async (req, res) => {
    let imagePath;
    try {
        // Validate upload
        if (!req.file) {
            throw new Error("No image uploaded");
        }

        // Process image
        imagePath = path.resolve(req.file.path);
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString("base64");
        const ext = path.extname(req.file.originalname).toLowerCase();
        const mimeType = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }[ext] || "image/jpeg";

        // Send to OpenAI
        const openaiResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Identify the bird species in this image. Provide response in format:\nSpecies: [name]\nDescription: [detailed description]\nLifespan: [Lifespan]\nCommonFood: [Common Food]\nCommonPredators: [Common Predators]\nScientificName: [scientific name]",
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`,
                            },
                        },
                    ],
                },
            ],
            max_tokens: 500,
            temperature: 0.2,
        });

        // Process OpenAI response
        const content = openaiResponse.choices[0]?.message?.content;
        if (!content) throw new Error("No classification received");

        // Robust parsing using field mapping
        const fields = {};
        content.split('\n').forEach(line => {
            const [key, ...valueParts] = line.split(':');
            if (key && valueParts.length) {
                fields[key.trim()] = valueParts.join(':').trim();
            }
        });

        // Validate required fields
        const requiredFields = ['Species', 'Description', 'Lifespan', 'CommonFood', 'CommonPredators', 'ScientificName'];
        const missingFields = requiredFields.filter(field => !(field in fields));

        if (missingFields.length > 0) {
            throw new Error(`Missing fields in response: ${missingFields.join(', ')}`);
        }

        const {
            Species: species,
            Description: description,
            Lifespan: lifespan,
            CommonFood: commonFood,
            CommonPredators: commonPredators,
            ScientificName: scientificName,
        } = fields;

        // Get bird sound from Xeno-Canto using scientific name
        const xenoCantoResponse = await axios.get(
            `https://xeno-canto.org/api/2/recordings?query=${scientificName}`
        );

        // Find the first recording with good quality
        const recordings = xenoCantoResponse.data.recordings?.slice(0, 3) || [];
        const soundUrls = recordings.map(r => r.file).filter(Boolean);
        const { birdImages, nestImages } = await getBirdAndNestImages(scientificName);

        res.json({
            success: true,
            species,
            description,
            scientificName,
            lifespan,
            commonFood,
            commonPredators,
            soundUrls,
            images: {
                bird: birdImages,
                nest: nestImages
            },
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    } finally {
        // Cleanup uploaded file
        if (imagePath && fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }
});

// Updated /bird-locations endpoint
app.get("/bird-locations", async (req, res) => {
    const { species, lat, lng, dist } = req.query;

    // Initialize an object to hold the response data
    const responseData = {
        success: true,
        observations: [],
        error: null,
    };

    // Check if species is provided
    if (!species) {
        responseData.error = "Species parameter is missing.";
    }

    // Check if lat, lng, and dist are provided
    if (!lat || !lng || !dist) {
        responseData.error = "Latitude, longitude, or distance parameter is missing.";
    }

    try {
        // If species is provided, get the species code
        let speciesCode = null;
        if (species) {
            speciesCode = getSpeciesCode(species);
            if (!speciesCode) {
                responseData.error = `No species code found for species: ${species}`;
            }
        }

        // If lat, lng, and dist are provided, fetch observations
        if (lat && lng && dist) {
            const apiResponse = await axios.get(
                `https://api.ebird.org/v2/data/obs/geo/recent/${speciesCode || ''}`,
                {
                    params: {
                        lat: parseFloat(lat),
                        lng: parseFloat(lng),
                        dist: parseInt(dist)
                    },
                    headers: { "X-eBirdApiToken": "nbne3sijs8r9" },
                }
            );

            // Map the observations to the desired format
            responseData.observations = apiResponse.data.map(obs => ({
                comName: obs.comName,
                locName: obs.locName,
                obsDt: obs.obsDt,
                lat: obs.lat,
                lng: obs.lng,
                howMany: obs.howMany // Optional: number of birds observed
            }));
        }

        // Send the response back to the frontend
        res.json(responseData);
    } catch (error) {
        console.error("Error fetching bird locations:", error.message);
        responseData.success = false;
        responseData.error = error.message;
        res.json(responseData);
    }
});

// Add bird location to CSV
app.post("/add-bird-location", express.json(), async (req, res) => {
    const { species, latitude, longitude, observationDate } = req.body;

    if (!species || !latitude || !longitude || !observationDate) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        // Check if the species exists
        const speciesCode = getSpeciesCode(species);
        if (!speciesCode) {
            return res.status(404).json({ error: "Species not found." });
        }

        // Append the data to the CSV file
        const csvLine = `${speciesCode},${latitude},${longitude},${observationDate}\n`;
        fs.appendFile(HISTORICAL_DATA_FILE, csvLine, (err) => {
            if (err) {
                console.error("Failed to append to historical data file:", err);
                return res.status(500).json({ error: "Failed to save data." });
            }

            console.log(`Added bird location data for ${species}.`);
            res.json({ message: "Bird location data added successfully." });
        });
    } catch (error) {
        console.error("Error adding bird location:", error);
        res.status(500).json({ error: "Failed to add bird location." });
    }
});

// Load taxonomy data on server start
loadTaxonomyData();

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
