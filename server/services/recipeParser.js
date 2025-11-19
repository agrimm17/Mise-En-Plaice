/**
 * Recipe Parser Service
 *
 * This module handles parsing recipes from two sources:
 * 1. URLs - Web scraping to extract recipe data from recipe websites
 * 2. Manual text - Direct text input from users
 *
 * The parser attempts to extract:
 * - Recipe title
 * - Ingredients list
 * - Cooking instructions
 * - Raw content (as fallback)
 *
 * Note: Web scraping is imperfect and depends on the website's HTML structure.
 * Different recipe sites use different markup, so this is a best-effort parser.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');

// Lazy-load OpenAI client to ensure dotenv has loaded environment variables
let openaiClient = null;
function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

/**
 * Parse recipe from a URL by scraping the webpage
 *
 * This function attempts to extract structured recipe data from a recipe website.
 * It uses multiple strategies to find recipe information:
 * 1. Looks for semantic HTML (itemprop attributes)
 * 2. Searches for common class name patterns
 * 3. Falls back to generic HTML elements (lists, paragraphs)
 * 4. If all else fails, returns raw page text
 *
 * @param {string} url - The URL of the recipe webpage to scrape
 * @returns {Promise<Object>} Parsed recipe object with:
 *   - title: string - Recipe title
 *   - source: string - The original URL
 *   - ingredients: Array<string> - List of ingredients (if found)
 *   - instructions: Array<string> - List of instruction steps (if found)
 *   - rawContent: string - Raw text content as fallback
 * @throws {Error} If the URL cannot be accessed or parsed
 *
 * @example
 * const recipe = await parseRecipeFromUrl('https://www.allrecipes.com/recipe/12345');
 */
async function parseRecipeFromUrl(url) {
  try {
    // Fetch the webpage with a user agent to avoid being blocked
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    // Load the HTML into Cheerio for parsing (jQuery-like syntax for server-side)
    const $ = cheerio.load(response.data);

    // Strategy 1: Extract recipe title
    // Try multiple common patterns used by recipe sites
    const title =
      $('h1').first().text().trim() ||
      $('[class*="recipe-title"]').first().text().trim() ||
      $('[class*="recipe-name"]').first().text().trim() ||
      'Untitled Recipe';

    // Strategy 2: Extract ingredients
    // First, try semantic HTML (microdata) and common class patterns
    let ingredients = [];
    const seenTexts = new Set();

    // Look for individual ingredient items, not containers
    // Many sites use <li> elements within ingredient containers
    $('[class*="ingredient"] li, [itemprop="recipeIngredient"]').each(
      (i, elem) => {
        const $elem = $(elem);
        // Only extract from top-level ingredient elements, not nested children
        // Check if this element has a parent that's also an ingredient element
        const hasIngredientParent =
          $elem.parents('[class*="ingredient"], [itemprop="recipeIngredient"]')
            .length > 0;

        if (!hasIngredientParent) {
          let text = $elem.text().trim();
          // Clean up special characters that might appear in ingredient lists
          // Remove common box-drawing characters and other special formatting
          text = text
            .replace(/[▢□▪▫•◦]/g, '') // Remove box/checkmark characters
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
          // Only add if we haven't seen this exact text (avoid duplicates from nested elements)
          if (text && !seenTexts.has(text) && text.length > 0) {
            seenTexts.add(text);
            ingredients.push(text);
          }
        }
      }
    );

    // Also check for direct ingredient elements (not in lists)
    // Some sites use <span> or <div> for each ingredient
    if (ingredients.length === 0) {
      $('[class*="ingredient"], [itemprop="recipeIngredient"]').each(
        (i, elem) => {
          const $elem = $(elem);
          // Skip if this element contains other ingredient elements (it's a container)
          const hasIngredientChildren =
            $elem.find('[class*="ingredient"], [itemprop="recipeIngredient"]')
              .length > 0;

          // Only extract from top-level ingredient elements, not nested children
          const hasIngredientParent =
            $elem.parents(
              '[class*="ingredient"], [itemprop="recipeIngredient"]'
            ).length > 0;

          if (!hasIngredientParent && !hasIngredientChildren) {
            let text = $elem.text().trim();
            // Clean up special characters that might appear in ingredient lists
            text = text
              .replace(/[▢□▪▫•◦]/g, '') // Remove box/checkmark characters
              .replace(/\s+/g, ' ') // Normalize whitespace
              .trim();
            // Only add if we haven't seen this exact text
            if (
              text &&
              !seenTexts.has(text) &&
              text.length > 0 &&
              text.length < 200
            ) {
              seenTexts.add(text);
              ingredients.push(text);
            }
          }
        }
      );
    }

    // Fallback: If no structured ingredients found, look for list items
    // BUT only within ingredient-related containers to avoid grabbing navigation/menu items
    // AND exclude instruction lists
    if (ingredients.length === 0) {
      // Look for lists that are within ingredient containers, but exclude instruction containers
      $('[class*="ingredient"] ul > li, [class*="ingredient"] ol > li').each(
        (i, elem) => {
          const $elem = $(elem);
          // Skip if this list item is inside another list item (nested)
          const isNested = $elem.parents('li').length > 0;
          // Skip if this is within an instruction container
          const isInInstructions =
            $elem.parents(
              '[class*="instruction"], [class*="step"], [class*="direction"]'
            ).length > 0;

          if (!isNested && !isInInstructions) {
            let text = $elem.text().trim();
            // Clean up special characters that might appear in ingredient lists
            text = text
              .replace(/[▢□▪▫•◦]/g, '') // Remove box/checkmark characters
              .replace(/\s+/g, ' ') // Normalize whitespace
              .trim();
            // Filter out very long items (likely instructions, not ingredients) and duplicates
            // Also filter out items that look like navigation/menu items or instructions
            const looksLikeIngredient =
              text.length > 3 &&
              text.length < 200 &&
              !text.toLowerCase().includes('menu') &&
              !text.toLowerCase().includes('navigation') &&
              !text.toLowerCase().includes('skip to') &&
              !text.toLowerCase().startsWith('step') &&
              !text.toLowerCase().startsWith('preheat') && // Common instruction starter
              !text.match(/^https?:\/\//) && // Not a URL
              !text.match(/^\d+\.\s+[A-Z]/); // Not a numbered instruction step

            if (text && !seenTexts.has(text) && looksLikeIngredient) {
              seenTexts.add(text);
              ingredients.push(text);
            }
          }
        }
      );
    }

    // Strategy 3: Extract instructions
    // Look for semantic HTML and common class patterns for steps
    let instructions = [];
    $(
      '[class*="instruction"], [class*="step"], [itemprop="recipeInstructions"]'
    ).each((i, elem) => {
      const text = $(elem).text().trim();
      if (text) instructions.push(text);
    });

    // Fallback: If no structured instructions, try paragraphs
    // (Some sites use <p> tags for each step)
    if (instructions.length === 0) {
      $('p').each((i, elem) => {
        const text = $(elem).text().trim();
        // Filter for reasonable instruction length (not too short, not too long)
        if (text.length > 50 && text.length < 500) {
          instructions.push(text);
        }
      });
    }

    // Strategy 4: If we couldn't extract structured data, use AI as fallback
    // Extract text from the page and use AI to parse ingredients/instructions
    if (ingredients.length === 0 || instructions.length === 0) {
      const bodyText = $('body').text().substring(0, 5000); // Limit size

      // If we have some data but missing ingredients or instructions, try AI
      if (bodyText.length > 100) {
        try {
          const openaiClient = getOpenAIClient();

          const systemPrompt = `You are a helpful cooking assistant that extracts structured recipe information from webpage text.

Your task is to parse recipe text and extract:
1. Recipe title (if not already provided)
2. List of ingredients
3. List of instruction steps

IMPORTANT RULES:
1. Extract the recipe title if it's clearly stated
2. Extract ALL ingredients mentioned in the text, one per line
3. Extract ALL instruction steps, one per line
4. Maintain the exact wording from the original text
5. Return your response as a JSON object with this exact structure:
{
  "title": "Recipe Title",
  "ingredients": ["ingredient 1", "ingredient 2", ...],
  "instructions": ["step 1", "step 2", ...]
}
6. If you cannot find ingredients or instructions, use empty arrays []
7. Do NOT include any text outside the JSON object`;

          const userPrompt = `Extract the recipe information from this webpage text. The title is: "${title}"

${bodyText}`;

          const model = process.env.OPENAI_MODEL || 'gpt-4';
          let aiResponse;
          try {
            aiResponse = await openaiClient.chat.completions.create({
              model: model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              temperature: 0.3,
              max_tokens: 2000,
              response_format: { type: 'json_object' },
            });
          } catch (modelError) {
            // Fallback to gpt-3.5-turbo if gpt-4 fails
            if (model === 'gpt-4' && modelError.message?.includes('gpt-4')) {
              console.log(
                'Falling back to gpt-3.5-turbo for URL recipe parsing...'
              );
              aiResponse = await openaiClient.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                max_tokens: 2000,
                response_format: { type: 'json_object' },
              });
            } else {
              throw modelError;
            }
          }

          const responseText = aiResponse.choices[0].message.content.trim();
          const parsedData = JSON.parse(responseText);

          // Merge AI-extracted data with what we already found
          if (parsedData.ingredients && parsedData.ingredients.length > 0) {
            ingredients = parsedData.ingredients.filter(
              (ing) => ing && ing.trim().length > 0
            );
          }
          if (parsedData.instructions && parsedData.instructions.length > 0) {
            instructions = parsedData.instructions.filter(
              (inst) => inst && inst.trim().length > 0
            );
          }
          if (parsedData.title && parsedData.title.trim().length > 0) {
            title = parsedData.title;
          }
        } catch (aiError) {
          console.error('Error using AI fallback for recipe parsing:', aiError);
          // Continue with what we have
        }
      }
    }

    // Return structured recipe data
    // Limit arrays to prevent token overflow in AI requests
    return {
      title: title || 'Recipe from URL',
      source: url,
      ingredients: ingredients.slice(0, 50), // Max 50 ingredients
      instructions: instructions.slice(0, 50), // Max 50 steps
      rawContent: $('body').text().substring(0, 2000), // Include some raw content for context
    };
  } catch (error) {
    console.error('Error parsing recipe from URL:', error);
    throw new Error(`Failed to parse recipe from URL: ${error.message}`);
  }
}

/**
 * Parse recipe from manual text input using AI
 *
 * For manual text input, we use OpenAI to extract structured recipe data
 * (title, ingredients, instructions) from unstructured text. This allows
 * users to paste recipe text and have it automatically parsed.
 *
 * @param {string} text - The recipe text/instructions provided by the user
 * @returns {Promise<Object>} Recipe object with:
 *   - title: string - Extracted recipe title (or default)
 *   - source: string - 'manual input'
 *   - ingredients: Array<string> - Extracted ingredients list
 *   - instructions: Array<string> - Extracted instruction steps
 *   - rawContent: string - The original user's text input
 * @throws {Error} If text is not provided, not a string, or AI parsing fails
 *
 * @example
 * const recipe = await parseRecipeFromText('1. Preheat oven to 350°F\n2. Mix flour and sugar...');
 */
async function parseRecipeFromText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid recipe text provided');
  }

  // If text is very short, just return it as rawContent
  if (text.trim().length < 50) {
    return {
      title: 'Manual Recipe',
      source: 'manual input',
      rawContent: text,
    };
  }

  try {
    const openaiClient = getOpenAIClient();

    const systemPrompt = `You are a helpful cooking assistant that extracts structured recipe information from unstructured text.

Your task is to parse recipe text and extract:
1. Recipe title (if mentioned)
2. List of ingredients
3. List of instruction steps

IMPORTANT RULES:
1. Extract the recipe title if it's clearly stated, otherwise use "Manual Recipe"
2. Extract ALL ingredients mentioned in the text, one per line
3. Extract ALL instruction steps, one per line
4. Maintain the exact wording from the original text
5. Return your response as a JSON object with this exact structure:
{
  "title": "Recipe Title",
  "ingredients": ["ingredient 1", "ingredient 2", ...],
  "instructions": ["step 1", "step 2", ...]
}
6. If you cannot find ingredients or instructions, use empty arrays []
7. Do NOT include any text outside the JSON object`;

    const userPrompt = `Extract the recipe information from this text:

${text.substring(0, 3000)}`;

    const model = process.env.OPENAI_MODEL || 'gpt-4';
    let response;
    try {
      response = await openaiClient.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });
    } catch (modelError) {
      // Fallback to gpt-3.5-turbo if gpt-4 fails
      if (model === 'gpt-4' && modelError.message?.includes('gpt-4')) {
        console.log('Falling back to gpt-3.5-turbo for recipe parsing...');
        response = await openaiClient.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        });
      } else {
        throw modelError;
      }
    }

    const responseText = response.choices[0].message.content.trim();
    const parsedData = JSON.parse(responseText);

    // Validate and structure the response
    return {
      title: parsedData.title || 'Manual Recipe',
      source: 'manual input',
      ingredients: Array.isArray(parsedData.ingredients)
        ? parsedData.ingredients.filter((ing) => ing && ing.trim().length > 0)
        : [],
      instructions: Array.isArray(parsedData.instructions)
        ? parsedData.instructions.filter(
            (inst) => inst && inst.trim().length > 0
          )
        : [],
      rawContent: text, // Always include original text as fallback
    };
  } catch (error) {
    console.error('Error parsing recipe from text with AI:', error);
    // Fallback: return the text as rawContent if AI parsing fails
    return {
      title: 'Manual Recipe',
      source: 'manual input',
      rawContent: text,
    };
  }
}

module.exports = {
  parseRecipeFromUrl,
  parseRecipeFromText, // Now async - returns Promise
};
