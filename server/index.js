/**
 * Mise-En-Plaice Backend Server
 *
 * This is the main Express server that handles API requests for the meal prep application.
 * It provides endpoints for:
 * - Recipe combination and parsing
 * - Health checks
 *
 * The server uses OpenAI API to intelligently combine multiple recipes into a single
 * optimized meal prep guide.
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const recipeRoutes = require('./routes/recipes');

// Load environment variables from .env file
// This must be called before any code that uses process.env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware Configuration
// CORS allows the React frontend (running on port 3000) to make requests to this server
app.use(cors());
// Express JSON parser allows the server to parse JSON request bodies
app.use(express.json());

// API Routes
// All recipe-related endpoints (e.g., /api/recipes/combine)
app.use('/api/recipes', recipeRoutes);

/**
 * Health Check Endpoint
 * GET /api/health
 *
 * Simple endpoint to verify the server is running.
 * Useful for monitoring and debugging.
 *
 * @returns {Object} Status object with 'ok' status and message
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Mise-En-Plaice API is running' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
