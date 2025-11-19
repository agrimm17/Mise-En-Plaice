/**
 * Ingredient Consolidator Service
 *
 * This module uses OpenAI to consolidate ingredient lists from multiple recipes
 * into a single list, grouping similar ingredients together for easier shopping.
 *
 * The service:
 * - Takes all ingredients from all recipes
 * - Uses AI to identify similar ingredients
 * - Groups them together (but doesn't merge quantities)
 * - Returns a single consolidated list
 */

require('dotenv').config();
const OpenAI = require('openai');

/**
 * Lazy-load OpenAI client to ensure environment variables are loaded
 * This prevents issues where OPENAI_API_KEY might not be available at module load time
 */
let openaiClient = null;
function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable is missing. Please add it to your .env file.'
      );
    }
    openaiClient = new OpenAI({
      apiKey: apiKey,
    });
  }
  return openaiClient;
}

const USE_OPENAI_CONSOLIDATION =
  process.env.USE_OPENAI_INGREDIENT_CONSOLIDATION === 'true';

const KEYWORD_PRIORITIES = [
  { keyword: 'oil', priority: 0 },
  { keyword: 'butter', priority: 1 },
  { keyword: 'garlic', priority: 2 },
  { keyword: 'onion', priority: 3 },
  { keyword: 'salt', priority: 4 },
  { keyword: 'pepper', priority: 5 },
  { keyword: 'sugar', priority: 6 },
  { keyword: 'flour', priority: 7 },
  { keyword: 'egg', priority: 8 },
  { keyword: 'milk', priority: 9 },
  { keyword: 'cream', priority: 10 },
  { keyword: 'cheese', priority: 11 },
  { keyword: 'tomato', priority: 12 },
  { keyword: 'chicken', priority: 13 },
  { keyword: 'beef', priority: 14 },
  { keyword: 'pasta', priority: 15 },
  { keyword: 'rice', priority: 16 },
  { keyword: 'beans', priority: 17 },
  { keyword: 'lemon', priority: 18 },
  { keyword: 'vinegar', priority: 19 },
  { keyword: 'broth', priority: 20 },
  { keyword: 'potato', priority: 21 },
  { keyword: 'carrot', priority: 22 },
  { keyword: 'celery', priority: 23 },
  { keyword: 'spinach', priority: 24 },
  { keyword: 'mushroom', priority: 25 },
  { keyword: 'bacon', priority: 26 },
  { keyword: 'sausage', priority: 27 },
  { keyword: 'fish', priority: 28 },
  { keyword: 'shrimp', priority: 29 },
  { keyword: 'pork', priority: 30 },
];

const DEFAULT_PRIORITY = KEYWORD_PRIORITIES.length;

const KEYWORD_MATCHERS = KEYWORD_PRIORITIES.map(({ keyword, priority }) => ({
  keywordLower: keyword.toLowerCase(),
  priority,
}));

const computeKeywordPriority = (text) => {
  const lower = text.toLowerCase();
  for (const { keywordLower, priority } of KEYWORD_MATCHERS) {
    if (lower.includes(keywordLower)) {
      return priority;
    }
  }
  return DEFAULT_PRIORITY;
};

/**
 * Consolidate ingredients from multiple recipes into a single grouped list
 *
 * This function takes all ingredients from all recipes and uses AI to:
 * 1. Combine them into one list
 * 2. Group similar ingredients together (e.g., "salt" and "salt, to taste")
 * 3. Keep items separate (don't merge quantities) but organize them
 *
 * @param {Array<Object>} recipes - Array of recipe objects with ingredients arrays
 * @returns {Promise<Array<Object>>} Consolidated and grouped ingredient list with recipe sources
 *   Each item has: { ingredient: string, recipes: Array<string> }
 * @throws {Error} If OpenAI API call fails
 *
 * @example
 * const recipes = [
 *   { title: 'Chocolate Cake', ingredients: ['2 cups flour', '1 tsp salt'] },
 *   { title: 'Vanilla Cake', ingredients: ['3 cups flour', 'salt, to taste'] }
 * ];
 * const consolidated = await consolidateIngredients(recipes);
 * // Returns: [
 * //   { ingredient: '2 cups flour', recipes: ['Chocolate Cake'] },
 * //   { ingredient: '3 cups flour', recipes: ['Vanilla Cake'] },
 * //   { ingredient: '1 tsp salt', recipes: ['Chocolate Cake'] },
 * //   { ingredient: 'salt, to taste', recipes: ['Vanilla Cake'] }
 * // ]
 * // (grouped with similar items next to each other)
 */
async function consolidateIngredients(recipes) {
  if (!recipes || recipes.length === 0) {
    return [];
  }

  // Collect all ingredients from all recipes with their source information
  const allIngredients = [];
  recipes.forEach((recipe, recipeIndex) => {
    if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
      recipe.ingredients.forEach((ingredient) => {
        allIngredients.push({
          ingredient: ingredient.trim(),
          recipeTitle: recipe.title || `Recipe ${recipeIndex + 1}`,
        });
      });
    }
  });

  if (allIngredients.length === 0) {
    return [];
  }

  // Build a unique ingredient map so we can track recipe sources and first appearance
  const ingredientMap = new Map();
  let appearanceCounter = 0;

  allIngredients.forEach((item) => {
    const key = item.ingredient;
    const title = item.recipeTitle || 'Unknown Recipe';

    if (!ingredientMap.has(key)) {
      ingredientMap.set(key, {
        ingredient: item.ingredient,
        recipes: new Set([title]),
        firstIndex: appearanceCounter++,
      });
    } else {
      ingredientMap.get(key).recipes.add(title);
    }
  });

  const uniqueIngredients = Array.from(ingredientMap.values());

  uniqueIngredients.forEach((entry) => {
    entry.priority = computeKeywordPriority(entry.ingredient);
  });

  let aiConsolidated = null;

  if (USE_OPENAI_CONSOLIDATION) {
    try {
      const openai = getOpenAIClient();

      const ingredientsList = uniqueIngredients
        .map((entry) => `- ${entry.ingredient}`)
        .join('\n');

      const systemPrompt = `You are a helpful cooking assistant that organizes ingredient lists for meal prep.

Your task is to take a list of ingredients and organize them by food type.

IMPORTANT RULES:
1. Keep ALL ingredients - do not remove or merge any items
2. Group similar food items together (put them next to each other)
3. Similar food items are those that refer to the same base ingredient (e.g., "salt" and "salt, to taste" are similar)
   - Treat all salt variants as similar (e.g., "salt", "sea salt", "kosher salt", "salt, to taste")
   - Treat garlic variants as similar (e.g., "3 garlic cloves", "minced garlic", "granulated garlic", "garlic powder")
   - Treat onion variants as similar (e.g., "onion", "1 yellow onion", "two onions", "onion powder")
   - Treat butter variants as similar (e.g., "butter", "unsalted butter", "melted butter")
   - Treat oil variants as similar (e.g., "olive oil", "vegetable oil", "canola oil", "cooking spray")
   - Similar seasonings or forms of the same base ingredient should be adjacent
4. Ignore leading numbers, quantities, or units when grouping or ordering; focus ONLY on the core ingredient words
5. Maintain the exact text of each ingredient and quantity as provided
6. Do not add any explanations or additional text
7. The goal is for someone to easily compare similar items side-by-side, regardless of recipe

Example:
Input:
- 2 tablespoons olive oil
- 1 tbsp butter
- 3 cloves garlic
- 1 teaspoon kosher salt
- 1 yellow onion
- garlic powder
- 4 cups flour
- onion powder

Possible Output:
2 tablespoons olive oil
1 tbsp butter
3 cloves garlic
garlic powder
1 teaspoon kosher salt
1 yellow onion
onion powder
4 cups flour`;

      const userPrompt = `Please organize these ingredients.
The list may contain duplicate lines because different recipes can use the same ingredient.
Focus only on grouping similar ingredients together so like items appear consecutively.
Ignore leading numbers or measurements when determining similarity—use the core ingredient words (especially for salt, garlic, onion, butter, and oil).

${ingredientsList}

Return the organized list with similar ingredients grouped together.`;

      const model = process.env.OPENAI_MODEL || 'gpt-4';
      let response;
      try {
        response = await openai.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        });
      } catch (modelError) {
        if (model === 'gpt-4' && modelError.message?.includes('gpt-4')) {
          console.log(
            'Falling back to gpt-3.5-turbo for ingredient consolidation...'
          );
          response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 2000,
          });
        } else {
          throw modelError;
        }
      }

      const consolidatedText = response.choices[0].message.content.trim();

      const normalizedMap = new Map();
      uniqueIngredients.forEach((entry) => {
        normalizedMap.set(
          entry.ingredient.toLowerCase().replace(/\s+/g, ' ').trim(),
          entry
        );
      });

      aiConsolidated = consolidatedText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();

          const matched =
            ingredientMap.get(line) || normalizedMap.get(normalized);

          if (matched) {
            return {
              ingredient: matched.ingredient,
              recipes: Array.from(matched.recipes),
            };
          }

          return {
            ingredient: line,
            recipes: ['Unknown Recipe'],
          };
        });

      if (aiConsolidated.length === 0) {
        aiConsolidated = null;
      }
    } catch (error) {
      console.error('Error consolidating ingredients with OpenAI:', error);
      aiConsolidated = null;
    }
  }

  if (aiConsolidated && aiConsolidated.length > 0) {
    return aiConsolidated;
  }

  const manualSorted = uniqueIngredients
    .sort((a, b) => {
      const priorityDiff = a.priority - b.priority;
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.firstIndex - b.firstIndex;
    })
    .map((entry) => ({
      ingredient: entry.ingredient,
      recipes: Array.from(entry.recipes),
    }));

  return manualSorted;
}

module.exports = {
  consolidateIngredients,
};
