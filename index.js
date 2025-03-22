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
const port = process.env.PORT || 5000;

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
      bird: ` ${scientificName}`, // Combine common and scientific names
      nest: `$ nest ${scientificName}`
    };

    const [birdImages, nestImages] = await Promise.all([
      fetchImages(searchQueries.bird, 10),
      fetchImages(searchQueries.nest, 5),
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
}// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
