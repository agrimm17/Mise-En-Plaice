/**
 * RecipeInput Component
 * 
 * Allows users to add recipes in two ways:
 * 1. URL Input: Paste a link to a recipe webpage (will be scraped by backend)
 * 2. Manual Input: Type or paste recipe instructions directly
 * 
 * Props:
 * @param {Array} recipes - Current list of recipes
 * @param {Function} setRecipes - Function to update the recipes list
 * 
 * Recipe Format:
 * Each recipe object has:
 * - type: 'url' | 'text'
 * - content: string (URL or text content)
 * 
 * The component maintains its own state for the input fields and switches
 * between URL and text input modes.
 */

import React, { useState } from 'react';
import './RecipeInput.css';

function RecipeInput({ recipes, setRecipes }) {
  // Local state for input management
  const [inputType, setInputType] = useState('url'); // 'url' or 'text'
  const [urlInput, setUrlInput] = useState(''); // URL input value
  const [textInput, setTextInput] = useState(''); // Manual text input value

  /**
   * handleAddRecipe
   * 
   * Adds a new recipe to the list based on the current input type.
   * Validates input and clears the form after adding.
   * 
   * Recipe objects are added to the parent's recipes state, which will
   * be sent to the backend when combining recipes.
   */
  const handleAddRecipe = () => {
    if (inputType === 'url') {
      if (!urlInput.trim()) {
        alert('Please enter a recipe URL');
        return;
      }
      setRecipes([...recipes, { type: 'url', content: urlInput.trim() }]);
      setUrlInput('');
    } else {
      if (!textInput.trim()) {
        alert('Please enter recipe instructions');
        return;
      }
      setRecipes([...recipes, { type: 'text', content: textInput.trim() }]);
      setTextInput('');
    }
  };

  /**
   * handleRemoveRecipe
   * 
   * Removes a recipe from the list by filtering out the item at the given index.
   * 
   * @param {number} index - The index of the recipe to remove
   */
  const handleRemoveRecipe = (index) => {
    setRecipes(recipes.filter((_, i) => i !== index));
  };

  return (
    <div className="recipe-input">
      <h2>Add Recipes</h2>
      
      <div className="input-type-selector">
        <button
          className={inputType === 'url' ? 'active' : ''}
          onClick={() => setInputType('url')}
        >
          Recipe URL
        </button>
        <button
          className={inputType === 'text' ? 'active' : ''}
          onClick={() => setInputType('text')}
        >
          Manual Input
        </button>
      </div>

      <div className="input-container">
        {inputType === 'url' ? (
          <div className="input-group">
            <input
              type="url"
              placeholder="Paste recipe URL here (e.g., https://www.allrecipes.com/recipe/...)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddRecipe()}
            />
            <button onClick={handleAddRecipe} className="add-button">
              Add Recipe
            </button>
          </div>
        ) : (
          <div className="input-group">
            <textarea
              placeholder="Paste or type recipe instructions here..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              rows="6"
            />
            <button onClick={handleAddRecipe} className="add-button">
              Add Recipe
            </button>
          </div>
        )}
      </div>

      {recipes.length > 0 && (
        <div className="recipes-list">
          <h3>Added Recipes ({recipes.length})</h3>
          {recipes.map((recipe, index) => (
            <div key={index} className="recipe-item">
              <div className="recipe-info">
                <span className="recipe-type">{recipe.type === 'url' ? '🔗 URL' : '📝 Text'}</span>
                <span className="recipe-content">
                  {recipe.type === 'url' 
                    ? recipe.content 
                    : recipe.content.substring(0, 100) + (recipe.content.length > 100 ? '...' : '')
                  }
                </span>
              </div>
              <button
                onClick={() => handleRemoveRecipe(index)}
                className="remove-button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default RecipeInput;

