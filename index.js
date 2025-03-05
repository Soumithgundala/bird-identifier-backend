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
  apiKey: "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"
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
              text: "Identify the bird species in this image. Provide response in format:\nSpecies: [name]\nDescription: [detailed description]\nLifespan: [Lifespan]\nCommonFood: [Common Food]\nCommonPredators:[Common Predators]\nscientificName: [scientific name]",
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
    
    const [speciesLine, scientificLine, descriptionLine, LifespanLine, CommonFoodLine, CommonPredatorsLine] = content.split("\n");
    const species = speciesLine.replace("Species: ", "").trim();
    const scientificName = scientificLine.replace("Scientific Name: ", "").trim().replace(/[()]/g, "");
    const description = descriptionLine.replace("Description: ", "").trim();
    const Lifespan = LifespanLine.replace("LifespanLine: ", "").trim();
    const CommonFood = CommonFoodLine.replace("CommonFood: ", "").trim();
    const CommonPredators = CommonPredatorsLine.replace("CommonPredators: ", "").trim();


    // Get bird sound from Xeno-Canto
    const xenoCantoResponse = await axios.get(
      `https://xeno-canto.org/api/2/recordings?query=${encodeURIComponent(species)}`
    );

    const soundUrl = xenoCantoResponse.data.recordings?.[0]?.file || null;

    res.json({
      success: true,
      species,
      description,
      scientificName,
      Lifespan,
      CommonFood,
      CommonPredators,
      soundUrl,
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

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});