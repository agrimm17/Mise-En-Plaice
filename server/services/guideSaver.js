/**
 * Guide Saver Service
 *
 * This module handles saving meal prep guides to files for later review.
 * Guides are saved with timestamps and metadata about the recipes used.
 */

const fs = require('fs').promises;
const path = require('path');

// Directory where saved guides will be stored
const SAVED_GUIDES_DIR = path.join(__dirname, '..', 'saved-guides');

/**
 * Ensure the saved-guides directory exists
 * Creates it if it doesn't exist
 *
 * @returns {Promise<void>}
 */
async function ensureDirectoryExists() {
  try {
    await fs.access(SAVED_GUIDES_DIR);
  } catch (error) {
    // Directory doesn't exist, create it
    await fs.mkdir(SAVED_GUIDES_DIR, { recursive: true });
  }
}

/**
 * Save a generated meal prep guide to a timestamped text file.
 *
 * @param {string} mealPrepGuide - The generated guide text
 * @param {Array<Object>} recipes - Array of recipe metadata (title, source)
 * @returns {Promise<string>} The filename of the saved guide
 */
async function saveGuide(mealPrepGuide, recipes) {
  // Ensure directory exists
  await ensureDirectoryExists();

  // Create filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `meal-prep-guide-${timestamp}.txt`;
  const filepath = path.join(SAVED_GUIDES_DIR, filename);

  // Build file content with metadata
  let content = '='.repeat(80) + '\n';
  content += 'MEAL PREP GUIDE\n';
  content += '='.repeat(80) + '\n\n';
  content += `Generated: ${new Date().toLocaleString()}\n\n`;

  // Add recipe information
  content += 'RECIPES INCLUDED:\n';
  content += '-'.repeat(80) + '\n';
  recipes.forEach((recipe, index) => {
    content += `${index + 1}. ${recipe.title}\n`;
    if (recipe.source && recipe.source !== 'manual input') {
      content += `   Source: ${recipe.source}\n`;
    }
  });
  content += '\n';

  // Add the meal prep guide
  content += '='.repeat(80) + '\n';
  content += 'MEAL PREP GUIDE\n';
  content += '='.repeat(80) + '\n\n';
  content += mealPrepGuide;
  content += '\n\n';
  content += '='.repeat(80) + '\n';
  content += `End of guide - Saved: ${new Date().toLocaleString()}\n`;
  content += '='.repeat(80) + '\n';

  // Write file
  try {
    await fs.writeFile(filepath, content, 'utf8');
    console.log(`Meal prep guide saved to: ${filepath}`);
    return filename;
  } catch (error) {
    console.error('Error saving guide to file:', error);
    throw new Error(`Failed to save guide to file: ${error.message}`);
  }
}

/**
 * Get list of all saved guides
 *
 * @returns {Promise<Array<Object>>} Array of guide metadata objects
 *   Each object has: { filename, filepath, createdAt }
 */
async function getSavedGuides() {
  try {
    await ensureDirectoryExists();
    const files = await fs.readdir(SAVED_GUIDES_DIR);

    // Filter for .txt files and get their stats
    const guides = await Promise.all(
      files
        .filter((file) => file.endsWith('.txt'))
        .map(async (filename) => {
          const filepath = path.join(SAVED_GUIDES_DIR, filename);
          const stats = await fs.stat(filepath);
          return {
            filename,
            filepath,
            createdAt: stats.birthtime,
            size: stats.size,
          };
        })
    );

    // Sort by creation date (newest first)
    return guides.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error('Error reading saved guides:', error);
    return [];
  }
}

/**
 * Read a saved guide file
 *
 * @param {string} filename - The filename of the guide to read
 * @returns {Promise<string>} The contents of the guide file
 * @throws {Error} If file doesn't exist or can't be read
 */
async function readSavedGuide(filename) {
  const filepath = path.join(SAVED_GUIDES_DIR, filename);

  // Security: prevent directory traversal
  if (!filename.endsWith('.txt') || filename.includes('..')) {
    throw new Error('Invalid filename');
  }

  try {
    const content = await fs.readFile(filepath, 'utf8');
    return content;
  } catch (error) {
    throw new Error(`Failed to read guide file: ${error.message}`);
  }
}

module.exports = {
  saveGuide,
  getSavedGuides,
  readSavedGuide,
};
