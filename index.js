import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// Configure CORS middleware
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["POST"],
  })
);

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

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: ""
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

    // Determine MIME type
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
    // console.log("Xeno-Canto API Response:", xenoCantoResponse.data);
    const recordings = xenoCantoResponse.data.recordings?.slice(0, 3) || [];
    // console.log("Recordings:", recordings);
    const soundUrls = recordings.map(r => r.file).filter(Boolean);
    const { birdImages, nestImages } = await getBirdAndNestImages(scientificName, species);
    
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
    // console.log("soundUrls", soundUrls);
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

// Unsplash Image Service
const UNSPLASH_API_KEY = ""; 
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
 // Function to fetch taxonomy and return the species code for a given name
 async function getSpeciesCode(speciesName) {
  try {
    const taxonomyResponse = await axios.get(
      "https://api.ebird.org/v2/ref/taxonomy/ebird",
      { 
        headers: { "X-eBirdApiToken": "" },
        responseType: 'text' // Ensure we get CSV text
      }
    );
    
    const csvData = taxonomyResponse.data;
    // Split CSV into lines and remove empty lines
    const lines = csvData.split('\n').filter(line => line.trim().length > 0);
    
    // If the first line does not contain a comma, assume it's a header or extraneous line and skip it
    let startIndex = 0;
    if (!lines[0].includes(',')) {
      startIndex = 1;
    }
    
    // Parse the remaining lines into an array of objects.
    // Here we assume:
    // Column 0: Scientific Name, Column 1: Common Name, Column 2: Species Code
    const taxonomyArray = lines.slice(startIndex).map(line => {
      const parts = line.split(',').map(p => p.trim());
      return {
        sciName: parts[0],
        comName: parts[1],
        speciesCode: parts[2]
      };
    });
    
    console.log("Parsed Taxonomy Array:", taxonomyArray);
    
    // Search for the entry where either common or scientific name matches the input (case-insensitive)
    const speciesEntry = taxonomyArray.find(entry =>
      entry.comName.toLowerCase() === speciesName.toLowerCase() ||
      entry.sciName.toLowerCase() === speciesName.toLowerCase()
    );
    
    return speciesEntry ? speciesEntry.speciesCode : null;
  } catch (error) {
    console.error("Error fetching taxonomy:", error);
    return null;
  }
}

app.get("/bird-locations", async (req, res) => {
  const { species, lat, lng, dist } = req.query;
  if (!species || !lat || !lng || !dist) {
    return res.status(400).json({
      success: false,
      error: "Missing required query parameters: species, lat, lng, dist",
    });
  }
  try {
    // Get the species code dynamically from the CSV taxonomy data
    const speciesCode = await getSpeciesCode(species);
    if (!speciesCode) {
      return res.status(400).json({
        success: false,
        error: `No species code found for species: ${species}`,
      });
    }

    const response = await axios.get(
      `https://api.ebird.org/v2/data/obs/geo/recent/${speciesCode}`,
      {
        params: { lat, lng, dist },
        headers: { "X-eBirdApiToken": "" },
      }
    );

    const observations = response.data.map(obs => ({
      comName: obs.comName,
      locName: obs.locName,
      obsDt: obs.obsDt,
      lat: obs.lat,
      lng: obs.lng
    }));

    res.json({ success: true, observations });
  } catch (error) {
    console.error("Error fetching bird locations:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
