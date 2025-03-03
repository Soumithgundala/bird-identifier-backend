import express from "express";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables

const app = express();
const port = 5000;

// Multer setup for image upload
const upload = multer({ dest: "uploads/" });

// Initialize OpenAI API
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Image Classification Route
app.post("/classify-bird", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image uploaded" });
        }

        // Read image file and convert to Base64
        const imagePath = req.file.path;
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString("base64");

        // OpenAI API request with correct GPT-4o image input format
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "What bird is in this image?" },
                        { 
                            type: "image_url",
                            image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                        }
                    ]
                }
            ]
        });

        // Extract response and send back
        const birdName = response.choices[0].message.content;
        res.json({ bird: birdName });

        // Cleanup: Remove uploaded image
        fs.unlinkSync(imagePath);
    } catch (error) {
        console.error("Error classifying image:", error);
        res.status(500).json({ error: "Failed to classify bird" });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
