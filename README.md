# Mise-En-Plaice

An AI-powered meal prep application that combines multiple recipes into a single, optimized cooking guide.

## Features

- **Multiple Recipe Input**: Add recipes via URL links or manual text input
- **AI-Powered Combination**: Uses OpenAI to intelligently combine recipes into one cohesive meal prep guide
- **Ingredient Consolidation**: Generates a grouped ingredient list so similar items appear together
- **Auto-Save**: Automatically saves generated guides to files for later review (in `server/saved-guides/`)

## Project Structure

```
Mise-En-Plaice/
├── server/                 # Backend Express server
│   ├── index.js           # Main server file (sets up Express, routes, middleware)
│   ├── routes/
│   │   └── recipes.js     # Recipe API endpoints (POST /api/recipes/combine)
│   └── services/
│       ├── recipeParser.js        # Parses recipes from URLs (web scraping) or text
│       ├── recipeCombiner.js      # AI service that combines recipes using OpenAI
│       ├── ingredientConsolidator.js # Consolidates ingredients from all recipes into shopping list
│       └── guideSaver.js          # Saves meal prep guides to files
│
└── client/                # React frontend
    └── src/
        ├── App.js         # Main app component (orchestrates everything)
        └── components/
            ├── RecipeInput.js      # Component for adding recipes (URL/text)
            └── MealPrepGuide.js    # Component for displaying the generated guide
```

## Key Files to Understand

1. **`server/index.js`**: Entry point for the backend. Sets up Express server, middleware, and routes.

2. **`server/routes/recipes.js`**: Main API endpoint that:

   - Receives recipes from the frontend
   - Parses each recipe (URL scraping or text)
   - Calls the AI service to combine recipes
   - Returns the meal prep guide

3. **`server/services/recipeParser.js`**: Handles recipe parsing:

   - `parseRecipeFromUrl()`: Web scraping using Cheerio to extract recipe data
   - `parseRecipeFromText()`: Uses OpenAI to extract structure from manual text input

4. **`server/services/recipeCombiner.js`**: Core AI service:

   - Formats recipes into AI prompts
   - Calls OpenAI API (GPT-4 or GPT-3.5-turbo)
   - Handles errors and fallbacks
   - Returns the combined meal prep guide

5. **`server/services/ingredientConsolidator.js`**: Ingredient consolidation service:

   - Combines ingredients from all recipes into a single list
   - Groups similar ingredients (oil, butter, onion, etc.) so they appear together

6. **`server/services/guideSaver.js`**: File saving service:

   - Saves generated guides to `server/saved-guides/` directory
   - Includes metadata (timestamp, recipes)
   - Creates timestamped filenames for easy organization

7. **`client/src/App.js`**: Main React component:

   - Manages application state (recipes, generated guide, errors)
   - Handles API communication
   - Orchestrates the user flow

8. **`client/src/components/RecipeInput.js`**: Recipe input UI:

   - Toggle between URL and text input
   - Add/remove recipes from list

9. **`client/src/components/MealPrepGuide.js`**: Guide display:

   - Formats AI output with proper styling
   - Provides copy/print functionality

## How It Works

1. **User Input**: User adds recipes (URLs or text)
2. **Recipe Parsing**: Backend scrapes URLs or uses text directly (with OpenAI assistance)
3. **Ingredient Consolidation**: Ingredients from all recipes are organized into a grouped list
4. **AI Processing**: OpenAI API receives formatted recipes and produces an optimized meal prep guide
5. **Auto-Save**: Guide is automatically saved to `server/saved-guides/`
6. **Display**: Frontend displays the grouped ingredient list, formatted guide, and shows save confirmation

## API Endpoints

- `GET /api/health` - Health check endpoint
- `POST /api/recipes/combine` - Combines recipes into meal prep guide
  - Request body: `{ recipes: Array }`
  - Response: `{ mealPrepGuide: string, recipes: Array, savedFilename?: string }`
  - The guide is automatically saved to `server/saved-guides/` directory
