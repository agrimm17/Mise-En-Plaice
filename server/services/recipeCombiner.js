/**
 * Recipe Combiner Service
 *
 * This is the core AI service that combines multiple recipes into a single
 * optimized meal prep guide. It uses OpenAI's GPT models to:
 *
 * 1. Analyze all recipes and their requirements
 * 2. Schedule cooking tasks efficiently (parallel cooking, shared oven time, etc.)
 * 3. Generate a step-by-step guide that combines all recipes
 *
 * The AI is prompted with:
 * - All recipe details (ingredients, instructions, raw content)
 * - Instructions to optimize for time and efficiency
 */

const OpenAI = require('openai');

// Lazy-load OpenAI client to ensure dotenv has loaded environment variables
// This is important because the OpenAI client is instantiated when the module loads,
// but dotenv.config() runs in index.js, so we need to delay client creation
let openai = null;

/**
 * Get or create the OpenAI client instance
 *
 * Uses lazy initialization pattern to ensure environment variables are loaded
 * before creating the client. This prevents errors when the module is first loaded.
 *
 * @returns {OpenAI} The OpenAI client instance
 * @throws {Error} If OPENAI_API_KEY is not set in environment variables
 */
function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

/**
 * Build prompts for recipe combination
 * Helper function to avoid code duplication between streaming and non-streaming versions
 *
 * @param {Array<Object>} recipes - Array of parsed recipe objects
 * @returns {Object} Object with systemPrompt and userPrompt
 */
function buildPrompts(recipes) {
  // Step 1: Format recipes for the AI prompt
  const recipesText = recipes
    .map((recipe, index) => {
      let text = `Recipe ${index + 1}: ${recipe.title}\n`;
      if (recipe.source) text += `Source: ${recipe.source}\n`;
      if (recipe.ingredients && recipe.ingredients.length > 0) {
        text += `Ingredients:\n${recipe.ingredients
          .map((ing) => `- ${ing}`)
          .join('\n')}\n`;
      }
      if (recipe.instructions && recipe.instructions.length > 0) {
        text += `Instructions:\n${recipe.instructions
          .map((inst, i) => `${i + 1}. ${inst}`)
          .join('\n')}\n`;
      }
      if (recipe.rawContent) {
        text += `Full Content:\n${recipe.rawContent.substring(0, 2000)}\n`;
      }
      return text;
    })
    .join('\n---\n\n');

  // Step 2: Construct the AI prompts
  const systemPrompt = `You are an expert meal prep coordinator. Your job is to combine multiple recipes into a single, optimized meal prep guide that allows for efficient simultaneous preparation of all dishes.

Consider the following when creating the guide:
1. Prioritize grouping similar tasks from different recipes together (e.g., all chopping from each recipe, all mixing) above all else.
2. Assume a standard home kitchen setup (one oven, four-burner stove, microwave, basic countertop appliances).
3. Optimize for time efficiency - do things in parallel when possible. While longer dishes cook, prepare the shorter dishes.
4. Consider cooking times and temperatures - can items share the same oven/space?
5. Provide clear, step-by-step instructions that are easy to follow
6. Include timing information whenever possible
7. Note when items can be prepared ahead of time. 

Format your response as a clear, numbered step-by-step guide.`;

  let userPrompt = `Please combine the following recipes into a single meal prep guide:

${recipesText}

Assume access to a standard home kitchen (oven, stovetop, microwave, common countertop tools).`;

  userPrompt += `\n\nCreate a comprehensive meal prep guide that combines all these recipes efficiently. Make sure to:
 - Combine similar preparation steps
 - Schedule tasks to maximize parallel cooking
 - Provide clear timing and sequencing
 - Include all necessary steps from all recipes

Format the output as a clear, numbered guide. Avoid using recipe name sections if possible.`;

  return { systemPrompt, userPrompt };
}

/**
 * Combine multiple recipes into a single meal prep guide using AI (streaming version)
 *
 * This function streams the AI-generated content chunk by chunk via a callback.
 * It's used for real-time display of the meal prep guide as it's being generated.
 *
 * @param {Array<Object>} recipes - Array of parsed recipe objects
 * @param {Function} onChunk - Callback function called for each chunk: (chunk: string) => void
 * @returns {Promise<string>} The complete AI-generated meal prep guide
 * @throws {Error} If API key is missing, API call fails, or other errors occur
 */
async function combineRecipesStream(recipes, onChunk) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const openaiClient = getOpenAIClient();
  const { systemPrompt, userPrompt } = buildPrompts(recipes);

  // Determine which model to use
  const model = process.env.OPENAI_MODEL || 'gpt-4';

  try {
    // Create streaming API call
    const stream = await openaiClient.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 3000,
      stream: true, // Enable streaming
    });

    let fullText = '';

    // Process stream chunks
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullText += content;
        // Send chunk to callback immediately
        onChunk(content);
      }
    }

    return fullText;
  } catch (error) {
    console.error('OpenAI API Error (streaming):', error);

    // Fallback to gpt-3.5-turbo if gpt-4 fails
    if (
      error.message.includes('gpt-4') &&
      process.env.OPENAI_MODEL !== 'gpt-3.5-turbo'
    ) {
      console.log('Falling back to gpt-3.5-turbo (streaming)...');
      try {
        const stream = await openaiClient.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 3000,
          stream: true,
        });

        let fullText = '';

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullText += content;
            onChunk(content);
          }
        }

        return fullText;
      } catch (fallbackError) {
        throw new Error(
          `Failed to generate meal prep guide: ${fallbackError.message}`
        );
      }
    }

    throw new Error(`Failed to generate meal prep guide: ${error.message}`);
  }
}

/**
 * Combine multiple recipes into a single meal prep guide using AI
 *
 * This is the main function that orchestrates the AI-powered recipe combination.
 * It:
 * 1. Formats all recipe data into a prompt-friendly format
 * 2. Constructs system and user prompts for the AI
 * 3. Calls OpenAI API to generate the combined guide
 * 4. Handles errors and fallbacks (e.g., GPT-4 -> GPT-3.5-turbo)
 *
 * @param {Array<Object>} recipes - Array of parsed recipe objects
 *   Each recipe should have: title, source, ingredients (optional), instructions (optional), rawContent
 * @returns {Promise<string>} The AI-generated meal prep guide as a formatted string
 * @throws {Error} If API key is missing, API call fails, or other errors occur
 *
 * @example
 * const guide = await combineRecipes([
 *   { title: 'Pasta', ingredients: ['pasta', 'sauce'], ... }
 * ]);
 */
async function combineRecipes(recipes) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const openaiClient = getOpenAIClient();
  const { systemPrompt, userPrompt } = buildPrompts(recipes);

  // Step 3: Call OpenAI API
  try {
    // Determine which model to use (configurable via OPENAI_MODEL env var)
    // Defaults to GPT-4 for best results, but can use GPT-3.5-turbo for lower cost
    const model = process.env.OPENAI_MODEL || 'gpt-4';

    // Make the API call
    // Temperature 0.7 provides a balance between creativity and consistency
    // Max tokens 3000 allows for detailed, comprehensive guides
    const completion = await openaiClient.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7, // Controls randomness: 0 = deterministic, 1 = very creative
      max_tokens: 3000, // Maximum length of the response
    });

    // Extract the generated text from the API response
    const mealPrepGuide = completion.choices[0].message.content;
    return mealPrepGuide;
  } catch (error) {
    console.error('OpenAI API Error:', error);

    // Error handling: If GPT-4 fails (e.g., API key doesn't have access),
    // automatically fall back to GPT-3.5-turbo which is more widely available
    if (
      error.message.includes('gpt-4') &&
      process.env.OPENAI_MODEL !== 'gpt-3.5-turbo'
    ) {
      console.log('Falling back to gpt-3.5-turbo...');
      try {
        const completion = await openaiClient.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 3000,
        });
        return completion.choices[0].message.content;
      } catch (fallbackError) {
        throw new Error(
          `Failed to generate meal prep guide: ${fallbackError.message}`
        );
      }
    }

    // Re-throw the error with a user-friendly message
    throw new Error(`Failed to generate meal prep guide: ${error.message}`);
  }
}

module.exports = {
  combineRecipes,
  combineRecipesStream,
};
