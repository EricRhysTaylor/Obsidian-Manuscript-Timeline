import type ManuscriptTimelinePlugin from './main';
import { decodeHtmlEntities, parseSceneTitleComponents, renderSceneTitleComponents } from './utils/text';

interface Scene {
  title?: string;
  date: string;
  path?: string;
  subplot?: string;
  act?: string;
  characters?: string[];
  pov?: string;
  location?: string;
  number?: number;
  synopsis?: string;
  when?: Date;
  actNumber?: number;
  Character?: string[];
  status?: string | string[];
  "Publish Stage"?: string;
  due?: string;
  pendingEdits?: string;
  "1beats"?: string;
  "2beats"?: string;
  "3beats"?: string;
}

/**
 * Handles generating synopsis SVG/HTML blocks and positioning logic.
 * (This is the class you formerly had inside main.ts, unchanged.)
 */
export default class SynopsisManager {
  private plugin: ManuscriptTimelinePlugin;

  constructor(plugin: ManuscriptTimelinePlugin) {
    this.plugin = plugin;
  }

  private parseHtmlSafely(html: string): DocumentFragment {
    // Use DOMParser to parse the HTML string
    const parser = new DOMParser();
    // Wrap with a root element to ensure proper parsing
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    
    // Extract the content from the wrapper div
    const container = doc.querySelector('div');
    const fragment = document.createDocumentFragment();
    
    if (container) {
      // Move all child nodes to our fragment
      while (container.firstChild) {
        fragment.appendChild(container.firstChild);
      }
    }
    
    return fragment;
  }
  
  /**
   * Add title content to a text element safely
   * @param titleContent The title content to add
   * @param titleTextElement The text element to add to
   * @param titleColor The color for the title
   */
  private addTitleContent(titleContent: string, titleTextElement: SVGTextElement, titleColor: string): void {
    if (titleContent.includes('<tspan')) {
      // For pre-formatted HTML with tspans, parse safely
      const parser = new DOMParser();
      // Wrap in SVG text element for potentially better parsing of SVG tspans/text nodes
      const doc = parser.parseFromString(`<svg><text>${titleContent}</text></svg>`, 'image/svg+xml');
      const textNode = doc.querySelector('text');

      if (!textNode) {
        // Fallback: If parsing fails, add raw content (less safe, but preserves something)
        console.warn("Failed to parse title content with tspans, adding raw:", titleContent);
        const fallbackTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        fallbackTspan.setAttribute("fill", titleColor);
        // Avoid setting textContent directly with potentially complex HTML
        // Instead, append the raw string as a text node for basic display
        fallbackTspan.appendChild(document.createTextNode(titleContent)); 
        titleTextElement.appendChild(fallbackTspan);
        return;
      }

      // Iterate through all child nodes (tspans and text nodes)
      Array.from(textNode.childNodes).forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() === 'tspan') {
          // Handle tspan element
          const tspan = node as Element;
          const svgTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          
          // Copy attributes
          Array.from(tspan.attributes).forEach(attr => {
            svgTspan.setAttribute(attr.name, attr.value);
          });
          
          svgTspan.textContent = tspan.textContent;
          titleTextElement.appendChild(svgTspan);
          
        } else if (node.nodeType === Node.TEXT_NODE) {
          // Handle text node (e.g., spaces)
          if (node.textContent) { // Check if textContent is not null or empty
            titleTextElement.appendChild(document.createTextNode(node.textContent));
          }
        }
        // Ignore other node types (like comments)
      });

    } else {
      // Non-search case (uses renderSceneTitleComponents which correctly handles spaces)
      const fragment = document.createDocumentFragment();
      const titleComponents = parseSceneTitleComponents(titleContent);
      renderSceneTitleComponents(titleComponents, fragment, undefined, titleColor);
      titleTextElement.appendChild(fragment);
    }
  }
  
  /**
   * Create a DOM element for a scene synopsis with consistent formatting
   * @returns An SVG group element containing the formatted synopsis
   */
  generateElement(scene: Scene, contentLines: string[], sceneId: string): SVGGElement {
    // Map the publish stage to a CSS class
    const stage = scene["Publish Stage"] || 'Zero';
    const stageClass = `title-stage-${String(stage).toLowerCase()}`;
    
    // Get the title color from the publish stage
    const titleColor = this.plugin.settings.publishStageColors[stage as keyof typeof this.plugin.settings.publishStageColors] || '#808080';
    
    // Determine where the synopsis content ends and metadata begins
    let synopsisEndIndex = contentLines.findIndex(line => line === '\u00A0' || line === '');
    if (synopsisEndIndex === -1) {
      // If no separator found, assume last two lines are metadata (subplots & characters)
      synopsisEndIndex = Math.max(0, contentLines.length - 2);
    }
    
    // Get metadata items - everything after the separator
    const metadataItems = contentLines.slice(synopsisEndIndex + 1);
    
    // Process all content lines to decode any HTML entities
    const decodedContentLines = contentLines.map(line => decodeHtmlEntities(line));
    
    // Create truly random color mappings for subplots and characters
    // These will generate new colors on every reload
    const getSubplotColor = (subplot: string): string => {
      // Generate a random dark color with good contrast (HSL: random hue, high saturation, low lightness)
      const hue = Math.floor(Math.random() * 360);
      const saturation = 60 + Math.floor(Math.random() * 20); // 60-80%
      const lightness = 25 + Math.floor(Math.random() * 15);  // 25-40% - dark enough for contrast
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    };
    
    const getCharacterColor = (character: string): string => {
      // Similar to subplot colors but with slightly different ranges
      const hue = Math.floor(Math.random() * 360);
      const saturation = 60 + Math.floor(Math.random() * 30); // 60-90%
      const lightness = 30 + Math.floor(Math.random() * 15);  // 30-45%
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    };
    
    // Set the line height
    const lineHeight = 24;
    let metadataY = 0;
    
    // Create the main container group
    const containerGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    containerGroup.setAttribute("class", "scene-info info-container");
    containerGroup.setAttribute("data-for-scene", sceneId);
    
    // Create the synopsis text group
    const synopsisTextGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    synopsisTextGroup.setAttribute("class", "synopsis-text");
    containerGroup.appendChild(synopsisTextGroup);
    
    // Add the title with publish stage color - at origin (0,0)
    const titleContent = decodedContentLines[0];
    const titleTextElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    titleTextElement.setAttribute("class", `info-text title-text-main ${stageClass}`);
    titleTextElement.setAttribute("x", "0");
    titleTextElement.setAttribute("y", "0");
    titleTextElement.setAttribute("text-anchor", "start");
    
    // Process title content with special handling for formatting
    this.addTitleContent(titleContent, titleTextElement, titleColor);
    
    synopsisTextGroup.appendChild(titleTextElement);
    
    // Add synopsis lines with precise vertical spacing
    for (let i = 1; i < synopsisEndIndex; i++) {
      const lineContent = decodedContentLines[i];
      const lineY = i * lineHeight; // Simplified vertical spacing
      
      const synopsisLineElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
      synopsisLineElement.setAttribute("class", "info-text title-text-secondary");
      synopsisLineElement.setAttribute("x", "0");
      synopsisLineElement.setAttribute("y", String(lineY));
      synopsisLineElement.setAttribute("text-anchor", "start");
      
      if (lineContent.includes('<tspan')) {
        // For pre-formatted HTML, we need to parse and create elements safely
        this.processContentWithTspans(lineContent, synopsisLineElement);
      } else {
        synopsisLineElement.textContent = lineContent;
      }
      
      synopsisTextGroup.appendChild(synopsisLineElement);
    }
    
    // Process metadata items with consistent vertical spacing
    if (metadataItems.length > 0) {
      
      // Helper function to add a spacer element
      const addSpacer = (yPosition: number, height: number) => {
        const spacerElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
        spacerElement.setAttribute("class", "synopsis-spacer");
        spacerElement.setAttribute("x", "0");
        spacerElement.setAttribute("y", String(yPosition));
        // Setting font-size to 0, as requested, since constants had no effect
        spacerElement.setAttribute("font-size", `0px`); 
        spacerElement.textContent = "\u00A0"; // Non-breaking space
        spacerElement.setAttribute("opacity", "0"); // Make it invisible
        synopsisTextGroup.appendChild(spacerElement);
        // Return value now adds 0 height, placing next block immediately after previous
        // Need to return the original yPosition so next block starts correctly relative to the last *content* block
        return yPosition; // Return the STARTING yPosition of the spacer
      };

      // --- Add Spacer IMMEDIATELY after Synopsis Text ---
      const synopsisBottomY = synopsisEndIndex * lineHeight;
      // Call addSpacer with height 0, and store the returned start position
      let currentMetadataY = addSpacer(synopsisBottomY, 0);

      // Process 1beats metadata if it exists
      if (scene["1beats"]) {
        const beatsY = currentMetadataY;
        const beatsText = scene["1beats"] || '';
        const linesAdded = this.formatBeatsText(beatsText, '1beats', synopsisTextGroup, beatsY, lineHeight, 0); // Pass '1beats'
        currentMetadataY = beatsY + (linesAdded * lineHeight);
        if (linesAdded > 0) {
          // Call addSpacer with height 0, update starting point for next block
          currentMetadataY = addSpacer(currentMetadataY, 0);
        }
      }
      
      // Process 2beats metadata if it exists
      if (scene["2beats"]) {
        const beatsY = currentMetadataY;
        const beatsText = scene["2beats"] || '';
        const linesAdded = this.formatBeatsText(beatsText, '2beats', synopsisTextGroup, beatsY, lineHeight, 0); // Pass '2beats'
        currentMetadataY = beatsY + (linesAdded * lineHeight);
        if (linesAdded > 0) {
           // Call addSpacer with height 0, update starting point for next block
          currentMetadataY = addSpacer(currentMetadataY, 0);
        }
      }
      
      // Process 3beats metadata if it exists
      if (scene["3beats"]) {
        const beatsY = currentMetadataY;
        const beatsText = scene["3beats"] || '';
        const linesAdded = this.formatBeatsText(beatsText, '3beats', synopsisTextGroup, beatsY, lineHeight, 0); // Pass '3beats'
        currentMetadataY = beatsY + (linesAdded * lineHeight);
        if (linesAdded > 0) {
          // Call addSpacer with height 0, update starting point for next block
          currentMetadataY = addSpacer(currentMetadataY, 0);
        }
      }
      
      // --- Subplot rendering starts here, using the final currentMetadataY ---
      // currentMetadataY now holds the Y position *before* the last added spacer (if any)
      // or after the last content block if no spacer was added.
      const subplotStartY = currentMetadataY; 

      // Process subplots if first metadata item exists
      const decodedMetadataItems = metadataItems.map(item => decodeHtmlEntities(item));
      
      if (decodedMetadataItems.length > 0 && decodedMetadataItems[0] && decodedMetadataItems[0].trim().length > 0) {
        const subplots = decodedMetadataItems[0].split(', ').filter(s => s.trim().length > 0);
        
          if (subplots.length > 0) {
            const subplotTextElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
            subplotTextElement.setAttribute("class", "info-text metadata-text");
            subplotTextElement.setAttribute("x", "0");
            // Use the calculated subplotStartY
            subplotTextElement.setAttribute("y", String(subplotStartY)); 
            subplotTextElement.setAttribute("text-anchor", "start");
            
            // Format each subplot with its own color
            subplots.forEach((subplot, j) => {
              const color = getSubplotColor(subplot.trim()); // Restore random color
              const subplotText = subplot.trim();
              const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
              tspan.setAttribute("data-item-type", "subplot");
              tspan.setAttribute("fill", color);
              tspan.setAttribute("style", `fill: ${color} !important`);
              tspan.textContent = subplotText;
              subplotTextElement.appendChild(tspan);
              if (j < subplots.length - 1) {
                const comma = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
                comma.setAttribute("fill", "var(--text-muted)");
                comma.textContent = ", ";
                subplotTextElement.appendChild(comma);
              }
            });
            
            synopsisTextGroup.appendChild(subplotTextElement);
        }
      }
      
      // Process characters - second metadata item
      if (decodedMetadataItems.length > 1 && decodedMetadataItems[1] && decodedMetadataItems[1].trim().length > 0) {
         // Calculate character Y based on subplot position plus standard line height
        const characterY = subplotStartY + lineHeight; 
        const characters = decodedMetadataItems[1].split(', ').filter(c => c.trim().length > 0);
        
        if (characters.length > 0) {
          const characterTextElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
          characterTextElement.setAttribute("class", "info-text metadata-text");
          characterTextElement.setAttribute("x", "0");
          characterTextElement.setAttribute("y", String(characterY));
          characterTextElement.setAttribute("text-anchor", "start");
          
          // Format each character with its own color
          characters.forEach((character, j) => {
            const color = getCharacterColor(character.trim()); // Restore random color
            const characterText = character.trim();
            const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
            tspan.setAttribute("data-item-type", "character");
            tspan.setAttribute("fill", color);
            tspan.setAttribute("style", `fill: ${color} !important`);
            tspan.textContent = characterText;
            characterTextElement.appendChild(tspan);
            if (j < characters.length - 1) {
              const comma = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
              comma.setAttribute("fill", "var(--text-muted)");
              comma.textContent = ", ";
              characterTextElement.appendChild(comma);
            }
          });
          
          synopsisTextGroup.appendChild(characterTextElement);
        }
      }
    }
    
    return containerGroup;
  }
  
  /**
   * Generate SVG string from DOM element (temporary compatibility method)
   */
  generateHTML(scene: Scene, contentLines: string[], sceneId: string): string {
    const element = this.generateElement(scene, contentLines, sceneId);
    const serializer = new XMLSerializer();
    return serializer.serializeToString(element);
  }
  
  /**
   * Update the position of a synopsis based on mouse position
   */
  updatePosition(synopsis: Element, event: MouseEvent, svg: SVGSVGElement, sceneId: string): void {
    if (!synopsis || !svg) {
      this.plugin.log("updatePosition: missing synopsis or svg element", {synopsis, svg});
      return;
    }
    
    try {
      // Get SVG coordinates from mouse position
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) {
        this.plugin.log("updatePosition: No SVG CTM available");
        return;
      }
      
      const svgP = pt.matrixTransform(ctm.inverse());
      
      // Determine which quadrant the mouse is in
      const quadrant = this.getQuadrant(svgP.x, svgP.y);
      
      // Calculate positioning parameters
      const size = 1600; // SVG size
      const margin = 30;
      const outerRadius = size / 2 - margin;
      const adjustedRadius = outerRadius - 20; // Reduce radius by 20px to move synopsis closer to center
      
      // Debug info
      if (this.plugin.settings.debug) {
        this.plugin.log(`Mouse position: SVG(${svgP.x.toFixed(0)}, ${svgP.y.toFixed(0)}), Quadrant: ${quadrant}`);
      }
      
      // Reset styles and classes
      (synopsis as SVGElement).removeAttribute('style');
      synopsis.classList.remove('synopsis-q1', 'synopsis-q2', 'synopsis-q3', 'synopsis-q4');
      
      // Configure position based on quadrant
      const position = this.getPositionForQuadrant(quadrant, adjustedRadius);
      
      // Apply the position class and base transform
      synopsis.classList.add(`synopsis-${position.quadrantClass}`);
      
      // Calculate the initial x-position based on Pythagorean theorem
      const y = position.y;
      let x = 0;
      
      // Pythagorean calculation for the base x-position
      // For y-coordinate on circle: x² + y² = r²
      if (Math.abs(y) < adjustedRadius) {
        x = Math.sqrt(adjustedRadius * adjustedRadius - y * y);
        
        // FIXED: Apply direction based on alignment - same convention as text positioning
        // For right-aligned text (Q1, Q4), x should be positive
        // For left-aligned text (Q2, Q3), x should be negative
        x = position.isRightAligned ? x : -x;
      }
      
      // Set the base transformation to position the synopsis correctly
      synopsis.setAttribute('transform', `translate(${x}, ${y})`);
      
      // Ensure the synopsis is visible
      synopsis.classList.add('visible');
      synopsis.setAttribute('opacity', '1');
      synopsis.setAttribute('pointer-events', 'all');
      
      // Position text elements to follow the arc
      this.positionTextElements(synopsis, position.isRightAligned, position.isTopHalf);
      
    } catch (e) {
      this.plugin.log("Error in updatePosition:", e);
    }
  }
  
  /**
   * Determine which quadrant a point is in
   * SVG coordinate system: (0,0) is at center
   * Q1: Bottom-Right (+x, +y)
   * Q2: Bottom-Left (-x, +y)
   * Q3: Top-Left (-x, -y)
   * Q4: Top-Right (+x, -y)
   */
  private getQuadrant(x: number, y: number): string {
    // Debug log to troubleshoot
    this.plugin.log(`Raw coordinates: x=${x}, y=${y}`);
    
    // Define quadrants based on SVG coordinates
    if (x >= 0 && y >= 0) return "Q1";      // Bottom Right (+x, +y)
    else if (x < 0 && y >= 0) return "Q2";  // Bottom Left (-x, +y)
    else if (x < 0 && y < 0) return "Q3";   // Top Left (-x, -y)
    else return "Q4";                       // Top Right (+x, -y)
  }
  
  /**
   * Get position configuration for a specific quadrant
   */
  private getPositionForQuadrant(quadrant: string, outerRadius: number): {
    x: number,
    y: number,
    quadrantClass: string,
    isRightAligned: boolean,
    isTopHalf: boolean
  } {
    // Place synopsis in opposite quadrant from mouse position (same half)
    let result = {
      x: 0,
      y: 0,
      quadrantClass: "",
      isRightAligned: false,
      isTopHalf: false
    };
    
    // Fixed vertical positions
    const topHalfOffset = -550; // Fixed vertical position from center for top half
    const bottomHalfOffset = 120; // Updated value for bottom half (Q1, Q2)
    
    // Debug log to troubleshoot
    this.plugin.log(`Processing quadrant: ${quadrant}`);
    
    switch (quadrant) {
      case "Q1": // Mouse in Bottom Right -> Synopsis in Q2 (Bottom Left)
        result.x = 0;
        result.y = bottomHalfOffset; // Bottom half with updated value
        result.quadrantClass = "q2";
        result.isRightAligned = false; // Left aligned
        result.isTopHalf = false;
        break;
        
      case "Q2": // Mouse in Bottom Left -> Synopsis in Q1 (Bottom Right)
        result.x = 0;
        result.y = bottomHalfOffset; // Bottom half with updated value
        result.quadrantClass = "q1";
        result.isRightAligned = true; // Right aligned
        result.isTopHalf = false;
        break;
        
      case "Q3": // Mouse in Top Left -> Synopsis in Q4 (Top Right)
        result.x = 0;
        result.y = topHalfOffset; // Top half (unchanged)
        result.quadrantClass = "q4";
        result.isRightAligned = true; // Right aligned
        result.isTopHalf = true;
        break;
        
      case "Q4": // Mouse in Top Right -> Synopsis in Q3 (Top Left)
        result.x = 0;
        result.y = topHalfOffset; // Top half (unchanged)
        result.quadrantClass = "q3";
        result.isRightAligned = false; // Left aligned
        result.isTopHalf = true;
        break;
    }
    
    // Debug log the result for troubleshooting
    this.plugin.log(`Synopsis positioning: quadrant=${result.quadrantClass}, isRightAligned=${result.isRightAligned}, y=${result.y}`);
    
    return result;
  }
  
  /**
   * Position text elements along an arc
   */
  private positionTextElements(synopsis: Element, isRightAligned: boolean, isTopHalf: boolean): void {
    // Find all text elements
    const textElements = Array.from(synopsis.querySelectorAll('text'));
    if (textElements.length === 0) return;
    
    // Set text anchor alignment based on quadrant
    const textAnchor = isRightAligned ? 'end' : 'start';
    textElements.forEach(textEl => {
      textEl.setAttribute('text-anchor', textAnchor);
    });
    
    // Get the synopsis text group
    const synopsisTextGroup = synopsis.querySelector('.synopsis-text');
    if (!synopsisTextGroup) {
      this.plugin.log("Error: Could not find synopsis text group");
      return;
    }
    
    // Reset any previous transforms
    (synopsisTextGroup as SVGElement).removeAttribute('transform');
    
    // Circle parameters
    const titleLineHeight = 32; // Increased spacing for title/date line
    const synopsisLineHeight = 22; // Reduced spacing for synopsis text
    const radius = 750; // Reduced from 770 by 20px to match the adjustedRadius in updatePosition
    
    // Calculate starting y-position from synopsis position
    const synopsisTransform = (synopsis as SVGElement).getAttribute('transform') || '';
    const translateMatch = synopsisTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);
    
    if (!translateMatch || translateMatch.length < 3) {
      this.plugin.log("Error: Could not parse synopsis transform", synopsisTransform);
      return;
    }
    
    const baseX = parseFloat(translateMatch[1]);
    const baseY = parseFloat(translateMatch[2]);
    
    this.plugin.log(`Base position parsed: x=${baseX}, y=${baseY}`);
    
    // Position each text element using Pythagorean theorem relative to circle center
    textElements.forEach((textEl, index) => {
      // Calculate absolute position for this line with variable line heights
      let yOffset = 0;
      
      if (index === 0) {
        // Title line - position at origin
        yOffset = 0;
      } else {
        // All other lines use the synopsis line height with title spacing
        yOffset = titleLineHeight + (index - 1) * synopsisLineHeight;
      }
      
      const absoluteY = baseY + yOffset;
      
      // First line (index 0) should be positioned at the circle's edge
      if (index === 0) {
        textEl.setAttribute('x', '0');
        textEl.setAttribute('y', '0');
        
        if (this.plugin.settings.debug) {
          this.plugin.log(`Title positioned at x=0, y=0, (absolute: ${baseX}, ${baseY})`);
        }
      } else {
        // For subsequent lines, calculate x-position using Pythagorean theorem
        // This makes text follow the circle's arc
        // For a point on a circle: x² + y² = r²
        let xOffset = 0;
        
        // Calculate distance for debugging
        //const distanceFromCenter = Math.sqrt(baseX * baseX + absoluteY * absoluteY);
        //this.plugin.log(`Line ${index} distance check: distanceFromCenter=${distanceFromCenter.toFixed(2)}, radius=${radius}`);
        
        // Calculate what the x-coordinate would be if this point were on the circle
        try {
          const circleX = Math.sqrt(radius * radius - absoluteY * absoluteY);
          
          // DEBUG: Log the values we're using
         // this.plugin.log(`Calculation for line ${index}: isTopHalf=${isTopHalf}, isRightAligned=${isRightAligned}, circleX=${circleX.toFixed(2)}, baseX=${baseX.toFixed(2)}`);
          
          // Calculate the x-offset for this line based on quadrant
          if (isTopHalf) {
            // Top half (Q3, Q4) - KEEP EXISTING BEHAVIOR
            if (isRightAligned) {
              // Q4 (top right) - text flows left
              xOffset = Math.abs(circleX) - Math.abs(baseX);
            } else {
              // Q3 (top left) - text flows right
              xOffset = Math.abs(baseX) - Math.abs(circleX);
            }
          } else {
            // Bottom half (Q1, Q2) - FIXED CALCULATION
            if (isRightAligned) {
              // Q1 (bottom right) - text flows left
              // Match Q4 formula with adjusted sign for bottom half
              xOffset = -(Math.abs(baseX) - Math.abs(circleX));
            } else {
              // Q2 (bottom left) - text flows right
              // Match Q3 formula that works correctly
              xOffset = Math.abs(baseX) - Math.abs(circleX);
            }
          }
          
        } catch (e) {
          // If calculation fails (e.g. sqrt of negative), use a fixed offset
          this.plugin.log(`Error calculating offset for line ${index}: ${e.message}`);
          xOffset = 0;
        }
        
        // Apply calculated coordinates relative to the base position
        textEl.setAttribute('x', String(Math.round(xOffset)));
        textEl.setAttribute('y', String(yOffset));
      }
      
      // Debug logging
      if (this.plugin.settings.debug && index <= 3) {
        this.plugin.log(`Text ${index} positioned at x=${textEl.getAttribute('x')}, y=${textEl.getAttribute('y')}, absoluteY=${absoluteY}`);
      }
    });
  }

  /**
   * Process content with tspan elements and add to an SVG element
   * @param content The HTML content to process
   * @param parentElement The SVG element to append processed nodes to
   */
  private processContentWithTspans(content: string, parentElement: SVGElement): void {
    this.plugin.log(`DEBUG: Processing content with tspans: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
    
    // First decode any HTML entities in the content
    let processedContent = content;
    
    // Check if the content contains HTML-encoded tspan elements
    if (content.includes('&lt;tspan') && !content.includes('<tspan')) {
      // Convert HTML entities to actual tags for proper parsing
      processedContent = content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
        
      this.plugin.log(`DEBUG: Decoded HTML entities in content`);
    }
    
    // Use DOMParser to parse the content safely
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${processedContent}</div>`, 'text/html');
    const container = doc.querySelector('div');

    if (!container) {
      this.plugin.log(`DEBUG: Failed to parse HTML content: no container found`);
      return;
    }
    
    // Check if there are any direct text nodes
    let hasDirectTextNodes = false;
    container.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        hasDirectTextNodes = true;
      }
    });
    
    this.plugin.log(`DEBUG: Content has direct text nodes: ${hasDirectTextNodes}`);
    
    if (hasDirectTextNodes) {
      // Handle mixed content (text nodes and elements)
      container.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          // Add text directly
          if (node.textContent?.trim()) {
            parentElement.appendChild(document.createTextNode(node.textContent));
            this.plugin.log(`DEBUG: Added text node: "${node.textContent}"`);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() === 'tspan') {
          // Handle tspan element
          const tspan = node as Element;
          const svgTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          
          // Copy attributes
          Array.from(tspan.attributes).forEach(attr => {
            svgTspan.setAttribute(attr.name, attr.value);
            
            // Fix any incorrectly formatted style attributes that might contain "limportant" instead of "!important"
            if (attr.name === 'style' && attr.value.includes('limportant')) {
              const fixedStyle = attr.value.replace(/\s*limportant\s*;?/g, ' !important;');
              svgTspan.setAttribute('style', fixedStyle);
            }
          });
          
          svgTspan.textContent = tspan.textContent;
          this.plugin.log(`DEBUG: Added tspan element with text: "${tspan.textContent}"`);
          parentElement.appendChild(svgTspan);
        }
      });
    } else {
      // Process only tspan elements
      const tspans = container.querySelectorAll('tspan');
      this.plugin.log(`DEBUG: Found ${tspans.length} tspan elements`);
      
      tspans.forEach(tspan => {
        const svgTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        
        // Copy attributes
        Array.from(tspan.attributes).forEach(attr => {
          svgTspan.setAttribute(attr.name, attr.value);
          
          // Fix any incorrectly formatted style attributes
          if (attr.name === 'style' && attr.value.includes('limportant')) {
            const fixedStyle = attr.value.replace(/\s*limportant\s*;?/g, ' !important;');
            svgTspan.setAttribute('style', fixedStyle);
          }
        });
        
        svgTspan.textContent = tspan.textContent;
        this.plugin.log(`DEBUG: Added tspan element with text: "${tspan.textContent}"`);
        parentElement.appendChild(svgTspan);
      });
    }
    
    // If no content was added to the parent element, add the original text as fallback
    if (!parentElement.hasChildNodes()) {
      this.plugin.log(`DEBUG: No content was added, using original text as fallback`);
      parentElement.textContent = content;
    }
  }

  // Add this new method for splitting text into lines
  private splitTextIntoLines(text: string, maxWidth: number): string[] {
    // Handle null, undefined, or non-string input
    if (!text || typeof text !== 'string') {
      this.plugin.log(`DEBUG: splitTextIntoLines received invalid text: ${text}`);
      return [''];  // Return an array with a single empty string
    }
    
    // Trim the text to remove leading/trailing whitespace
    const trimmedText = text.trim();
    
    // Check if the trimmed text is empty
    if (!trimmedText) {
      this.plugin.log(`DEBUG: splitTextIntoLines received empty or whitespace-only text`);
      return [''];  // Return an array with a single empty string for empty content
    }
    
    // Simple line splitting based on approximate character count
    const words = trimmedText.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';
    const maxCharsPerLine = 50; // Approximately 400px at 16px font size
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordWidth = word.length;
      
      if (currentLine.length + wordWidth + 1 > maxCharsPerLine && currentLine !== '') {
        lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine.trim());
    }
    
    // If we still end up with no lines, ensure we return something
    if (lines.length === 0) {
      this.plugin.log(`DEBUG: splitTextIntoLines produced no lines, returning default`);
      return [trimmedText]; // Return the trimmed text as a single line
    }
    
    this.plugin.log(`DEBUG: splitTextIntoLines produced ${lines.length} lines from text of length ${text.length}`);
    return lines;
  }

  /**
   * Formats and adds beat text lines to an SVG group.
   * @param beatsText The multi-line string containing beats for one section.
   * @param beatKey The key identifying the section ('1beats', '2beats', '3beats').
   * @param parentGroup The SVG group element to append the text elements to.
   * @param baseY The starting Y coordinate for the first line.
   * @param lineHeight The vertical distance between lines.
   * @param spacerSize Size of the spacer to add after this beats section.
   */
  private formatBeatsText(beatsText: string, beatKey: '1beats' | '2beats' | '3beats', parentGroup: SVGElement, baseY: number, lineHeight: number, spacerSize: number = 0): number {
    // START: Restore line splitting logic
    if (!beatsText || typeof beatsText !== 'string' || beatsText === 'undefined' || beatsText === 'null') {
      return 0;
    }
    beatsText = beatsText.replace(/undefined|null/gi, '').trim();
    if (!beatsText) {
      return 0;
    }
    let lines: string[] = [];
    if (beatsText.trim().includes('\n')) {
      lines = beatsText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    } else {
      const trimmedText = beatsText.trim();
      if (trimmedText.startsWith('-')) {
        if (trimmedText.length > 1) { lines = [trimmedText]; }
      } else {
        lines = trimmedText.split(',').map(item => `- ${item.trim()}`).filter(line => line.length > 2);
        if (lines.length === 0 && trimmedText.length > 0) {
          lines = [`- ${trimmedText}`];
        }
      }
    }
    // END: Restore line splitting logic

    // Add this after the line splitting logic but before the for loop
    // Around line 1275-1280, right after "// END: Restore line splitting logic"

    // Pre-process lines that are too long (specifically for 2beats)
    if (beatKey === '2beats' && lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // First extract any grade notation like [B]
        let gradePrefix = "";
        const gradeMatch = line.match(/^\s*(\[[A-Z][+-]?\]\s*)/);
        if (gradeMatch) {
          gradePrefix = gradeMatch[1];
          line = line.substring(gradeMatch[0].length).trim();
        }
        
        // Instead of building word-based segments, split on commas directly
        if (line.includes(',')) {
          // Split by commas and create new lines from each segment
          const segments = line.split(',').map(segment => segment.trim()).filter(segment => segment.length > 0);
          
          if (segments.length > 1) {
            // First segment keeps the grade prefix
            const firstSegment = segments.shift() || '';
            const processedLines = [
              gradePrefix ? `${gradePrefix} ${firstSegment}` : firstSegment,
              ...segments.map(segment => `- ${segment}`)
            ];
            
            // Replace current line with expanded lines
            lines.splice(i, 1, ...processedLines);
            
            // Adjust i to account for the new lines
            i += processedLines.length - 1;
            continue;
          }
        }
        
        // If line has a grade prefix but no commas, reattach the grade prefix
        if (gradePrefix) {
          lines[i] = `${gradePrefix} ${line}`;
        }
      }
    }

    let currentY = baseY;
    let lineCount = 0;
  
    // Add a grade border line for the 2beats section if it has a letter grade
    let detectedGrade: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line.startsWith('-')) { line = `- ${line}`; }
      let rawContent = line.substring(1).trim();
      if (!rawContent) continue;

      // --- Revised Splitting and Formatting Logic --- 
      let titleText = rawContent; // Default: whole line is title
      let commentText = '';     // Default: no comment
      let titleClass = 'beats-text-neutral'; // Default class
      let commentClass = 'beats-text'; // Default comment class
      let signDetected: string | null = null; // Store the detected sign (+, -, ?)
      let useSlashSeparator = false; // Flag to control adding " / "

      // 1. Find the specific "Sign /" pattern
      const signSlashPattern = /^(.*?)\s*([-+?])\s*\/\s*(.*)$/;
      const match = rawContent.match(signSlashPattern);

      if (match) {
        // Pattern "Title Sign / Comment" found
        titleText = match[1].trim();    // Part before the sign
        signDetected = match[2];        // The actual sign (+, -, ?)
        commentText = match[3].trim(); // Part after the slash
        useSlashSeparator = true;     // We found the pattern, so use the slash
        // NOTE: Title sign is implicitly removed because titleText comes from group 1 (before the sign)
      } else {
         // Pattern not found. Check if there's a sign at the end for coloring, but don't split.
         const endSignMatch = rawContent.match(/\s*([-+?])$/);
         if (endSignMatch) {
           signDetected = endSignMatch[1];
           // Remove the sign from the title text for display
           titleText = rawContent.substring(0, endSignMatch.index).trim();
         }
         // No split needed, commentText remains empty, useSlashSeparator remains false
      }

      // 2. Determine Title CSS Class based on the detected sign
      if (signDetected === '+') {
        titleClass = 'beats-text-positive';
      } else if (signDetected === '-') {
        titleClass = 'beats-text-negative';
      } // Otherwise remains 'beats-text-neutral'
      
      // Handle special case for 2beats first line grade
      let isFirstLineOf2Beats = (beatKey === '2beats' && i === 0);
      let detectedGrade: string | null = null;
      if (isFirstLineOf2Beats) {
        // Look for Grade (A, B, C) potentially at the start of titleText
        const gradeMatch = titleText.match(/^\s*\d+(\.\d+)?\s+([ABC])(?![A-Za-z0-9])/i);
         if (gradeMatch && gradeMatch[2]) {
            detectedGrade = gradeMatch[2].toUpperCase();
            // Override classes for the grade line
            titleClass = 'beats-text-grade'; 
            commentClass = 'beats-text-grade';
         }
      }

      // --- Create SVG Elements --- 
      const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
      textElement.setAttribute("class", "beats-text"); // Base class for the line
      textElement.setAttribute("x", "0");
      textElement.setAttribute("y", String(currentY));
      textElement.setAttribute("text-anchor", "start");

      // Create Tspan for the Title part
      const titleTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      titleTspan.setAttribute("class", titleClass); // Apply class based on sign/grade
      titleTspan.textContent = titleText; // Already processed/sign removed
      textElement.appendChild(titleTspan);

      // Create Tspan for the Comment part (if applicable)
      if (useSlashSeparator && commentText) {
        const commentTspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        commentTspan.setAttribute("class", commentClass); // Default or grade class
        commentTspan.textContent = " / " + commentText; // Add the slash separator
        textElement.appendChild(commentTspan);
      } else if (commentText && !useSlashSeparator) {
         // Case where a sign was found at the end but no slash - commentText is empty, so nothing added.
      }

      parentGroup.appendChild(textElement);
      currentY += lineHeight;
      lineCount++;
    }

    // Add grade border if detected
    if (detectedGrade && beatKey === '2beats') {
      // Find the scene group this synopsis belongs to
      const sceneGroup = parentGroup.closest('.scene-group');
      if (sceneGroup) {
        // Find the number-square in the scene group
        const numberSquare = sceneGroup.querySelector('.number-square');
        if (numberSquare) {
          // Add the grade class to the number square
          numberSquare.classList.add(`grade-${detectedGrade}`);

          // Create or update the grade border
          let gradeBorder = sceneGroup.querySelector('.grade-border-line');
           if (!gradeBorder) {
              gradeBorder = document.createElementNS("http://www.w3.org/2000/svg", "rect");
               gradeBorder.setAttribute("class", `grade-border-line grade-${detectedGrade}`);
              
              // Copy size and position from number-square
              const x = numberSquare.getAttribute('x') || "0";
              const y = numberSquare.getAttribute('y') || "0";
              const width = numberSquare.getAttribute('width') || "0";
              const height = numberSquare.getAttribute('height') || "0";
              
              gradeBorder.setAttribute("x", x);
              gradeBorder.setAttribute("y", y);
              gradeBorder.setAttribute("width", width);
              gradeBorder.setAttribute("height", height);
              gradeBorder.setAttribute("fill", "none");
              
              // Insert the border before the number-square for proper z-index
               numberSquare.parentNode?.insertBefore(gradeBorder, numberSquare);
           } else {
              // Update existing border with the grade class
               gradeBorder.setAttribute("class", `grade-border-line grade-${detectedGrade}`);
           }
         }
       }
     }

    // Add spacer at the end of this section if needed
    if (spacerSize > 0) {
      const addSpacer = (yPosition: number, height: number) => {
        const spacer = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        spacer.setAttribute("class", "synopsis-spacer");
        spacer.setAttribute("x", "0");
        spacer.setAttribute("y", String(yPosition));
        spacer.setAttribute("width", "20");
        spacer.setAttribute("height", String(height));
        spacer.setAttribute("fill", "transparent");
        parentGroup.appendChild(spacer);
      };
      
      addSpacer(currentY, spacerSize);
        currentY += spacerSize;
    }

    return lineCount;
  }
}