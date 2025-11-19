/**
 * Recipe Routes
 *
 * This module handles all recipe-related API endpoints.
 * Main functionality: combining multiple recipes into a single meal prep guide.
 */

const express = require('express');
const router = express.Router();
const {
  combineRecipes,
  combineRecipesStream,
} = require('../services/recipeCombiner');
const {
  parseRecipeFromUrl,
  parseRecipeFromText,
} = require('../services/recipeParser');
const { saveGuide } = require('../services/guideSaver');
const {
  consolidateIngredients,
} = require('../services/ingredientConsolidator');

/**
 * POST /api/recipes/combine
 *
 * Combines multiple recipes (from URLs or manual text) into a single optimized meal prep guide.
 *
 * Request Body:
 * @param {Array} recipes - Array of recipe objects
 * @param {string} recipes[].type - Either 'url' or 'text'
 * @param {string} recipes[].content - The URL or text content of the recipe
 *
 * Response:
 * @returns {Object} { mealPrepGuide: string, savedFilename?: string }
 *   The AI-generated combined meal prep guide and optional saved filename
 *
 * Error Responses:
 * - 400: Invalid input (no recipes, invalid recipe type)
 * - 500: Server error (parsing failed, AI API error, etc.)
 *
 * Process Flow:
 * 1. Validate input (must have at least one recipe)
 * 2. Parse each recipe (scrape URL or use text as-is)
 * 3. Send parsed recipes to AI service
 * 4. Save the guide to a file (server/saved-guides/)
 * 5. Return the combined meal prep guide and saved filename
 */
router.post('/combine', async (req, res) => {
  try {
    const { recipes } = req.body;

    if (!recipes || !Array.isArray(recipes) || recipes.length === 0) {
      return res
        .status(400)
        .json({ error: 'Please provide at least one recipe' });
    }

    const invalidRecipe = recipes.find(
      (recipe) => recipe.type !== 'url' && recipe.type !== 'text'
    );

    if (invalidRecipe) {
      return res
        .status(400)
        .json({ error: 'Invalid recipe type. Use "url" or "text"' });
    }

    const parsedRecipes = await Promise.all(
      recipes.map((recipe) =>
        recipe.type === 'url'
          ? parseRecipeFromUrl(recipe.content)
          : parseRecipeFromText(recipe.content)
      )
    );

    // Set up Server-Sent Events (SSE) headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial metadata about recipes
    res.write(
      `data: ${JSON.stringify({
        type: 'metadata',
        recipes: parsedRecipes.map((recipe) => ({
          title: recipe.title,
          source: recipe.source,
          ingredients: recipe.ingredients || [],
        })),
      })}\n\n`
    );

    // Step 2: Combine recipes using AI with streaming
    let fullMealPrepGuide = '';
    try {
      fullMealPrepGuide = await combineRecipesStream(parsedRecipes, (chunk) => {
        // Send each chunk to the client as it arrives
        res.write(`data: ${JSON.stringify({ type: 'chunk', chunk })}\n\n`);
        // Force flush the response to ensure chunks are sent immediately
        if (typeof res.flush === 'function') {
          res.flush();
        }
      });

      // Step 3: Save the guide to a file for later review
      let savedFilename = null;
      try {
        savedFilename = await saveGuide(fullMealPrepGuide, parsedRecipes);
      } catch (saveError) {
        // Log error but don't fail the request - saving is optional
        console.error('Failed to save guide to file:', saveError);
      }

      // Send completion signal with final data
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          savedFilename: savedFilename || undefined,
        })}\n\n`
      );
      res.end();
    } catch (streamError) {
      // Send error as SSE event
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: streamError.message || 'Failed to generate meal prep guide',
        })}\n\n`
      );
      res.end();
    }
  } catch (error) {
    console.error('Error combining recipes:', error);
    // If we haven't started streaming yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({
        error: error.message || 'Failed to combine recipes',
      });
    } else {
      // Already streaming, send error as SSE event
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: error.message || 'Failed to combine recipes',
        })}\n\n`
      );
      res.end();
    }
  }
});

/**
 * POST /api/recipes/consolidate-ingredients
 *
 * Consolidates ingredients from multiple recipes into a single grouped list.
 * This endpoint should be called AFTER generating a meal prep guide.
 *
 * Request Body:
 * @param {Array} recipes - Array of recipe objects with ingredients arrays
 *
 * Response:
 * @returns {Object} { consolidatedIngredients: Array<string> } - The consolidated ingredient list
 *
 * Error Responses:
 * - 400: Invalid input (no recipes)
 * - 500: Server error (AI API error, etc.)
 */
router.post('/consolidate-ingredients', async (req, res) => {
  try {
    const { recipes } = req.body;

    if (!recipes || !Array.isArray(recipes) || recipes.length === 0) {
      return res
        .status(400)
        .json({ error: 'Please provide at least one recipe with ingredients' });
    }

    // Consolidate ingredients using AI
    const consolidatedIngredients = await consolidateIngredients(recipes);

    res.json({
      consolidatedIngredients,
    });
  } catch (error) {
    console.error('Error consolidating ingredients:', error);
    res
      .status(500)
      .json({ error: error.message || 'Failed to consolidate ingredients' });
  }
});

module.exports = router;
