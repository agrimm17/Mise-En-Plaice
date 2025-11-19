/**
 * Mise-En-Plaice Main App Component
 *
 * This is the root React component that orchestrates the entire application.
 * It manages:
 * - Recipe list (URLs and manual text)
 * - API communication with the backend
 * - Display of the generated meal prep guide
 *
 * Component Structure:
 * - RecipeInput: Allows users to add recipes via URL or manual text
 * - MealPrepGuide: Displays the AI-generated combined guide
 *
 * Data Flow:
 * 1. User adds recipes
 * 2. User clicks "Generate Meal Prep Guide"
 * 3. App sends POST request to /api/recipes/combine
 * 4. Backend parses recipes, calls OpenAI API
 * 5. App displays the generated guide
 */

import React, { useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import './App.css';
import RecipeInput from './components/RecipeInput';
import MealPrepGuide from './components/MealPrepGuide';

function App() {
  // State Management
  // recipes: Array of recipe objects { type: 'url'|'text', content: string }
  const [recipes, setRecipes] = useState([]);
  // mealPrepGuide: The AI-generated combined guide (string)
  const [mealPrepGuide, setMealPrepGuide] = useState(null);
  // isStreaming: Track if we're currently streaming (for UI optimization)
  const [isStreaming, setIsStreaming] = useState(false);
  // savedFilename: The filename of the saved guide (if successfully saved)
  const [savedFilename, setSavedFilename] = useState(null);
  // recipesWithIngredients: Array of recipe objects with their ingredients
  const [recipesWithIngredients, setRecipesWithIngredients] = useState([]);
  // consolidatedIngredients: Array of consolidated ingredients (grouped together)
  const [consolidatedIngredients, setConsolidatedIngredients] = useState([]);
  // consolidating: Boolean flag to show loading state during consolidation API call
  const [consolidating, setConsolidating] = useState(false);
  // loading: Boolean flag to show loading state during API call
  const [loading, setLoading] = useState(false);
  // error: Error message string to display to user
  const [error, setError] = useState(null);
  // activeView: Which view is currently displayed ('guide' | 'ingredients' | 'consolidated')
  const [activeView, setActiveView] = useState('guide');
  // Track if we've already triggered automatic consolidation
  const consolidationTriggeredRef = useRef(false);

  /**
   * handleCombineRecipes
   *
   * Main function that combines all recipes into a meal prep guide.
   *
   * Process:
   * 1. Validates that at least one recipe exists
   * 2. Sets loading state and clears previous errors
   * 3. Sends POST request to backend API with recipes
   * 4. Handles response and displays guide or error
   *
   * Error Handling:
   * - Network errors (server not running)
   * - Server errors (500, parsing failures, etc.)
   * - JSON parsing errors (proxy errors, etc.)
   *
   * The fetch uses the React proxy (configured in package.json) which forwards
   * /api/* requests to http://localhost:5001
   */
  const handleCombineRecipes = async () => {
    if (recipes.length === 0) {
      setError('Please add at least one recipe');
      return;
    }

    setLoading(true);
    setError(null);
    setMealPrepGuide(''); // Clear previous guide - use empty string so component can render
    setRecipesWithIngredients([]); // Clear previous recipes
    setSavedFilename(null); // Clear saved filename
    setIsStreaming(false); // Reset streaming state
    consolidationTriggeredRef.current = false; // Reset consolidation trigger

    try {
      // For streaming, connect directly to backend to avoid proxy buffering
      // In production, use the proxy path
      const apiUrl =
        process.env.NODE_ENV === 'production'
          ? '/api/recipes/combine'
          : 'http://localhost:5001/api/recipes/combine';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipes,
        }),
      });

      // Handle HTTP errors (4xx, 5xx status codes)
      if (!response.ok) {
        // Try to parse error as JSON (normal API error response)
        // But handle cases where server returns HTML (proxy errors, etc.)
        let errorData;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          // Normal API error - parse JSON
          errorData = await response.json();
        } else {
          // Non-JSON response (likely HTML error page from proxy)
          const text = await response.text();
          throw new Error(
            `Server error (${response.status}): ${text.substring(0, 100)}`
          );
        }
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      // Check if response is streaming (Server-Sent Events)
      // Streaming responses use text/event-stream content type and send data incrementally
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/event-stream')) {
        // Handle streaming response
        // Set streaming flag to optimize UI rendering during stream
        setIsStreaming(true);
        const reader = response.body.getReader(); // Get stream reader
        const decoder = new TextDecoder(); // Decode binary chunks to text
        let buffer = ''; // Buffer for incomplete lines

        // Read chunks from the stream until done
        while (true) {
          const { done, value } = await reader.read();
          if (done) break; // Stream complete

          // Decode chunk and append to buffer
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer for next iteration

          // Process each complete line
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)); // Parse JSON after "data: " prefix

                if (data.type === 'metadata') {
                  // Metadata event: Contains recipe information with ingredients
                  // This arrives first, before the guide starts streaming
                  const recipes = data.recipes || [];
                  setRecipesWithIngredients(recipes);
                  // Automatically consolidate ingredients once we have them
                  // Pass recipes directly to avoid race condition with state update
                  if (
                    recipes &&
                    recipes.length > 0 &&
                    !consolidationTriggeredRef.current
                  ) {
                    consolidationTriggeredRef.current = true;
                    // Small delay ensures state is set before consolidation runs
                    setTimeout(() => {
                      handleConsolidateIngredients(recipes);
                    }, 100);
                  }
                } else if (data.type === 'chunk') {
                  // Chunk event: A piece of the meal prep guide text
                  // Append each chunk immediately to show progress in real-time
                  const chunk = data.chunk;
                  if (chunk) {
                    // Use flushSync to force immediate render (bypasses React batching)
                    // This ensures the UI updates as each chunk arrives, not all at once
                    flushSync(() => {
                      setMealPrepGuide((prev) => (prev || '') + chunk);
                    });
                  }
                } else if (data.type === 'done') {
                  // Done event: Guide generation is complete
                  setIsStreaming(false);
                  if (data.savedFilename) {
                    setSavedFilename(data.savedFilename);
                  }
                  setLoading(false);
                  // Consolidation should already be triggered by metadata event
                  // But if it wasn't, trigger it here as fallback
                  // Note: recipesWithIngredients should be set by metadata event
                  if (!consolidationTriggeredRef.current) {
                    consolidationTriggeredRef.current = true;
                    setTimeout(() => {
                      // Use state value as fallback (should be set by now)
                      if (recipesWithIngredients.length > 0) {
                        handleConsolidateIngredients(recipesWithIngredients);
                      }
                    }, 200);
                  }
                } else if (data.type === 'error') {
                  // Error event: Something went wrong during generation
                  setIsStreaming(false);
                  throw new Error(
                    data.error || 'Failed to generate meal prep guide'
                  );
                }
              } catch (parseError) {
                // Skip malformed JSON lines (shouldn't happen, but be defensive)
                console.warn('Failed to parse SSE data:', parseError);
              }
            }
          }
        }
      } else {
        // Fallback: Handle non-streaming response (for backwards compatibility)
        // This path is used if the server doesn't support streaming or returns JSON directly
        const data = await response.json();
        setMealPrepGuide(data.mealPrepGuide);
        setSavedFilename(data.savedFilename || null);
        const recipes = data.recipes || [];
        setRecipesWithIngredients(recipes);
        setLoading(false);
        // Automatically consolidate ingredients after guide is generated
        // Pass recipes directly to avoid race condition with state update
        if (
          recipes &&
          recipes.length > 0 &&
          !consolidationTriggeredRef.current
        ) {
          consolidationTriggeredRef.current = true;
          // Small delay ensures state is set before consolidation runs
          setTimeout(() => {
            handleConsolidateIngredients(recipes);
          }, 100);
        }
      }
    } catch (err) {
      // Error handling with user-friendly messages
      let errorMessage = err.message;

      // Network errors (server not running, CORS issues, etc.)
      if (err.message === 'Failed to fetch' || err.message.includes('Proxy')) {
        errorMessage =
          'Unable to connect to the backend server. Please make sure the backend server is running on port 5001. Start it with: cd server && npm start';
      }
      // JSON parsing errors (usually means proxy returned HTML instead of JSON)
      else if (err.message.includes('JSON')) {
        errorMessage =
          'Server connection error. Please make sure the backend server is running on port 5001.';
      }

      setError(errorMessage);
      console.error('Error combining recipes:', err);
      setLoading(false);
    }
  };

  /**
   * handleConsolidateIngredients
   *
   * Consolidates ingredients from all recipes into a single grouped list using AI.
   * This should be called AFTER generating the meal prep guide.
   *
   * Process:
   * 1. Validates that recipes with ingredients exist
   * 2. Sets consolidating state and clears previous errors
   * 3. Sends POST request to backend API with recipes
   * 4. Handles response and displays consolidated list or error
   *
   * @param {Array} recipesToConsolidate - Optional array of recipes to consolidate.
   *   If not provided, uses recipesWithIngredients from state.
   */
  const handleConsolidateIngredients = async (recipesToConsolidate = null) => {
    // Use provided recipes or fall back to state
    const recipes = recipesToConsolidate || recipesWithIngredients;

    if (!recipes || recipes.length === 0) {
      setError(
        'No recipes with ingredients available. Please generate a meal prep guide first.'
      );
      return;
    }

    setConsolidating(true);
    setError(null);

    try {
      // Send POST request to consolidate ingredients endpoint
      // The backend uses AI to group similar ingredients together
      const response = await fetch('/api/recipes/consolidate-ingredients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipes: recipes, // Send recipes with their ingredients
        }),
      });

      // Handle HTTP errors (4xx, 5xx status codes)
      if (!response.ok) {
        let errorData;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          errorData = await response.json();
        } else {
          const text = await response.text();
          throw new Error(
            `Server error (${response.status}): ${text.substring(0, 100)}`
          );
        }
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      // Success: Parse and display the consolidated ingredients
      // The response contains an array of ingredients grouped by similarity
      const data = await response.json();
      setConsolidatedIngredients(data.consolidatedIngredients || []);
    } catch (err) {
      // Error handling with user-friendly messages
      let errorMessage = err.message;

      // Network errors (server not running, CORS issues, etc.)
      if (err.message === 'Failed to fetch' || err.message.includes('Proxy')) {
        errorMessage =
          'Unable to connect to the backend server. Please make sure the backend server is running on port 5001.';
      }
      // JSON parsing errors (usually means proxy returned HTML instead of JSON)
      else if (err.message.includes('JSON')) {
        errorMessage =
          'Server connection error. Please make sure the backend server is running on port 5001.';
      }

      setError(errorMessage);
      console.error('Error consolidating ingredients:', err);
    } finally {
      setConsolidating(false);
    }
  };

  return (
    <div className='App'>
      <header className='App-header'>
        <h1>🍳 Mise-En-Pl(AI)ce</h1>
        <p>AI-Powered Meal Prep Guide Combiner</p>
      </header>

      <main className='App-main'>
        <div className='container'>
          <section className='section'>
            <RecipeInput recipes={recipes} setRecipes={setRecipes} />
          </section>

          <section className='section'>
            <button
              className='combine-button'
              onClick={handleCombineRecipes}
              disabled={loading || recipes.length === 0}
            >
              {loading ? 'Combining Recipes...' : 'Generate Meal Prep Guide'}
            </button>
          </section>

          {error && (
            <section className='section'>
              <div className='error-message'>{error}</div>
            </section>
          )}

          {/* Tab Navigation - Only show if we have content to display */}
          {(mealPrepGuide ||
            recipesWithIngredients.length > 0 ||
            consolidatedIngredients.length > 0) && (
            <section
              className='section'
              style={{ padding: 0, marginBottom: 0 }}
            >
              <div className='view-tabs'>
                <button
                  className={`view-tab ${
                    activeView === 'guide' ? 'active' : ''
                  }`}
                  onClick={() => setActiveView('guide')}
                  disabled={!mealPrepGuide && !loading}
                >
                  📝 Meal Prep Guide
                </button>
                <button
                  className={`view-tab ${
                    activeView === 'ingredients' ? 'active' : ''
                  }`}
                  onClick={() => setActiveView('ingredients')}
                  disabled={recipesWithIngredients.length === 0}
                >
                  📋 Ingredients by Recipe
                </button>
                <button
                  className={`view-tab ${
                    activeView === 'consolidated' ? 'active' : ''
                  }`}
                  onClick={() => setActiveView('consolidated')}
                  disabled={consolidatedIngredients.length === 0}
                >
                  🛒 Consolidated Shopping List
                </button>
              </div>
            </section>
          )}

          {/* Meal Prep Guide View */}
          {activeView === 'guide' && (mealPrepGuide || loading) && (
            <section className='section'>
              <MealPrepGuide
                guide={mealPrepGuide || ''}
                savedFilename={savedFilename}
                isStreaming={isStreaming}
              />
            </section>
          )}

          {/* Ingredients by Recipe View */}
          {activeView === 'ingredients' &&
            recipesWithIngredients.length > 0 && (
              <section className='section'>
                <div className='ingredients-section'>
                  <h2>📋 Ingredients by Recipe</h2>
                  {recipesWithIngredients.map((recipe, recipeIndex) => (
                    <div key={recipeIndex} className='recipe-ingredients'>
                      <h3 className='recipe-ingredients-title'>
                        {recipe.title}
                      </h3>
                      {recipe.source && recipe.source !== 'manual input' && (
                        <p className='recipe-source'>{recipe.source}</p>
                      )}
                      {recipe.ingredients && recipe.ingredients.length > 0 ? (
                        <ul className='ingredients-list'>
                          {recipe.ingredients.map((ingredient, ingIndex) => (
                            <li key={ingIndex} className='ingredient-item'>
                              {ingredient}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className='no-ingredients'>
                          No ingredients found for this recipe.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

          {/* Consolidated Ingredients View */}
          {activeView === 'consolidated' &&
            consolidatedIngredients.length > 0 && (
              <section className='section'>
                <div className='ingredients-section'>
                  <h2>🛒 Consolidated Shopping List</h2>
                  <p className='consolidated-description'>
                    All ingredients grouped by similarity for easier shopping:
                  </p>
                  <div className='consolidated-ingredients-content'>
                    <ul className='ingredients-list'>
                      {consolidatedIngredients.map((item, ingIndex) => {
                        const ingredient =
                          typeof item === 'string' ? item : item.ingredient;
                        const recipes =
                          typeof item === 'string' ? [] : item.recipes || [];

                        return (
                          <li key={ingIndex} className='ingredient-item'>
                            <span className='ingredient-text'>
                              {ingredient}
                            </span>
                            {recipes.length > 0 && (
                              <span className='ingredient-recipe-label'>
                                {recipes.join(', ')}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className='guide-actions'>
                    <button
                      onClick={() => {
                        const text = consolidatedIngredients
                          .map((item) =>
                            typeof item === 'string' ? item : item.ingredient
                          )
                          .join('\n');
                        navigator.clipboard.writeText(text);
                        alert('Consolidated ingredients copied to clipboard!');
                      }}
                      className='copy-button'
                    >
                      📋 Copy to Clipboard
                    </button>
                    <button
                      onClick={() => {
                        const printWindow = window.open('', '_blank');
                        printWindow.document.write(`
                        <html>
                          <head>
                            <title>Consolidated Shopping List</title>
                            <style>
                              body { font-family: Arial, sans-serif; padding: 20px; }
                              h1 { color: #333; }
                              ul { list-style: none; padding: 0; }
                              li { padding: 8px 0; border-bottom: 1px solid #e0e0e0; }
                            </style>
                          </head>
                          <body>
                              <h1>Consolidated Shopping List</h1>
                              <ul>
                              ${consolidatedIngredients
                                .map((item) => {
                                  const ing =
                                    typeof item === 'string'
                                      ? item
                                      : item.ingredient;
                                  const recipes =
                                    typeof item === 'string'
                                      ? []
                                      : item.recipes || [];
                                  const recipeLabel =
                                    recipes.length > 0
                                      ? ` <small>(${recipes.join(
                                          ', '
                                        )})</small>`
                                      : '';
                                  return `<li>${ing}${recipeLabel}</li>`;
                                })
                                .join('')}
                              </ul>
                          </body>
                        </html>
                      `);
                        printWindow.document.close();
                        printWindow.print();
                      }}
                      className='print-button'
                    >
                      🖨️ Print List
                    </button>
                  </div>
                </div>
              </section>
            )}
        </div>
      </main>
    </div>
  );
}

export default App;
