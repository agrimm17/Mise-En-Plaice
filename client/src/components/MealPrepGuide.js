/**
 * MealPrepGuide Component
 *
 * Displays the AI-generated meal prep guide in a formatted, readable way.
 *
 * Features:
 * - Formats the guide text with proper styling for headings, steps, and paragraphs
 * - Provides copy-to-clipboard functionality
 * - Provides print functionality
 *
 * Props:
 * @param {string} guide - The AI-generated meal prep guide text
 * @param {string} savedFilename - Optional filename if the guide was saved to a file
 *
 * Formatting Logic:
 * The component attempts to identify different types of content:
 * - Headings: Lines starting with # or all-caps text
 * - Steps: Numbered list items (e.g., "1. ", "2)")
 * - Paragraphs: Regular text blocks
 *
 * This provides visual hierarchy and makes the guide easier to follow.
 */

import React from 'react';
import './MealPrepGuide.css';

function MealPrepGuide({ guide, savedFilename, isStreaming = false }) {
  // Show component even with empty guide (for streaming)
  if (guide === null) return null;

  /**
   * formatGuide
   *
   * Formats the raw guide text into React elements with appropriate styling.
   * Attempts to identify and style different content types:
   * - Headings (markdown-style # or all-caps)
   * - Numbered steps
   * - Regular paragraphs
   *
   * @param {string} text - The raw guide text from the AI
   * @returns {Array<React.Element>} Array of formatted React elements
   */
  const formatGuide = (text) => {
    // Split by double newlines to preserve paragraph structure
    const paragraphs = text.split(/\n\n+/);

    return paragraphs.map((paragraph, index) => {
      // Pattern 1: Numbered list items (e.g., "1. ", "2)", "10. ")
      // These are styled as steps with special formatting
      if (/^\d+[.)]\s/.test(paragraph.trim())) {
        return (
          <p key={index} className='guide-step'>
            {paragraph}
          </p>
        );
      }

      // Pattern 2: Headings
      // Markdown-style headings (# Heading) or all-caps text
      if (
        paragraph.trim().match(/^#+\s/) ||
        paragraph.trim() === paragraph.trim().toUpperCase()
      ) {
        return (
          <h3 key={index} className='guide-heading'>
            {paragraph.replace(/^#+\s/, '')} {/* Remove markdown # symbols */}
          </h3>
        );
      }

      // Pattern 3: Regular paragraphs
      // Everything else is treated as a paragraph
      return (
        <p key={index} className='guide-paragraph'>
          {paragraph}
        </p>
      );
    });
  };

  return (
    <div className='meal-prep-guide'>
      <h2>Your Meal Prep Guide</h2>
      {savedFilename && (
        <div className='saved-notification'>
          💾 Guide saved to: <code>{savedFilename}</code>
          <br />
          <small>Location: server/saved-guides/</small>
        </div>
      )}
      <div className='guide-content'>
        {guide && guide.length > 0 ? (
          // During streaming, show raw text for smoother updates
          // After streaming completes, show formatted version
          isStreaming ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{guide}</div>
          ) : (
            formatGuide(guide)
          )
        ) : (
          <p style={{ color: '#666', fontStyle: 'italic' }}>
            Generating guide...
          </p>
        )}
      </div>
      <div className='guide-actions'>
        <button
          onClick={() => {
            navigator.clipboard.writeText(guide);
            alert('Guide copied to clipboard!');
          }}
          className='copy-button'
        >
          📋 Copy to Clipboard
        </button>
        <button onClick={() => window.print()} className='print-button'>
          🖨️ Print Guide
        </button>
      </div>
    </div>
  );
}

export default MealPrepGuide;
