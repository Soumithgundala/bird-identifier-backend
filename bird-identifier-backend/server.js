const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

const app = express();
const port = 5000;

app.use(cors());

// Configure Multer for in-memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.post("/classify", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Create a FormData instance and append the file
    const formData = new FormData();
    formData.append("image", req.file.buffer, {
      filename: "bird.jpg",
      contentType: req.file.mimetype,
    });

    // ✅ Replace with the actual API URL
    const response = await axios.post(
      "`https://api.inaturalist.org/v1/taxa?q=${query}`", // Replace with your API
      formData,
      { headers: { ...formData.getHeaders() } }
    );

    res.json({ birdName: response.data.birdName });
  } catch (error) {
    console.error("Error classifying bird:", error);
    res.status(500).json({ error: "Bird classification failed" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
