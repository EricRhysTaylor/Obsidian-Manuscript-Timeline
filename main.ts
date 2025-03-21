import { App, Plugin, Notice, Setting, PluginSettingTab, TFile, TAbstractFile, WorkspaceLeaf, ItemView } from "obsidian";

interface ManuscriptTimelineSettings {
    sourcePath: string;
    publishStageColors: {
        Zero: string;
        Author: string;
        House: string;
        Press: string;
    };
    debug: boolean; // Add debug setting
}

// Constants for the view
const TIMELINE_VIEW_TYPE = "manuscript-timeline-view";
const TIMELINE_VIEW_DISPLAY_TEXT = "Manuscript Timeline";

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
    when?: Date; // Keep for backward compatibility 
    actNumber?: number; // Keep for backward compatibility
    Character?: string[]; // Keep for backward compatibility
    status?: string | string[]; // Add status property
    "Publish Stage"?: string; // Add publish stage property
    due?: string; // Add due date property
    Edits?: string; // Add edits property
}

// Add this interface to store scene number information for the scene square and synopsis
interface SceneNumberInfo {
    number: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

const DEFAULT_SETTINGS: ManuscriptTimelineSettings = {
    sourcePath: 'Book 1',
    publishStageColors: {
        "Zero": "#9E70CF",  // Purple
        "Author": "#5E85CF", // Blue
        "House": "#DA7847",  // Orange
        "Press": "#6FB971"   // Green
    },
    debug: false // Default to false
};

//a primary color for each status
// 6FB971 green, DA7847 orange, 7C6561 flat brown, 9E70CF purple, 5E85CF Blue, bbbbbb gray 
const STATUS_COLORS = {
    "Working": "#70b970",
    "Todo": "#aaaaaa",
    "Empty": "#f0f0f0", // Light gray (will be replaced with light Zero color)
    "Due": "#d05e5e"
};

const NUM_ACTS = 3;

function formatNumber(num: number): string {
    if (Math.abs(num) < 0.001) return "0";
    return num.toFixed(3).replace(/\.?0+$/, '');
}

function parseSceneTitle(title: string): { number: string; text: string } {
    const firstSpace = title.indexOf(' ');
    if (firstSpace === -1) return { number: '', text: title };
    
    const number = title.substring(0, firstSpace);
    // Check if the first part is a valid number (integer or decimal)
    if (!number.match(/^\d+(\.\d+)?$/)) {
        return { number: '', text: title };
    }
    
    return {
        number: number,
        text: title.substring(firstSpace + 1)
    };
}

export default class ManuscriptTimelinePlugin extends Plugin {
    settings: ManuscriptTimelineSettings;
    
    // Add this property to track the active view
    activeTimelineView: ManuscriptTimelineView | null = null;

    async onload() {
        await this.loadSettings();
        
        // Register the timeline view
        this.registerView(
            TIMELINE_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => {
                const view = new ManuscriptTimelineView(leaf, this);
                this.activeTimelineView = view;
                return view;
            }
        );
        
        // Add ribbon icon for the new view
        this.addRibbonIcon('calendar-with-checkmark', 'Manuscript Timeline', () => {
            this.activateView();
        });

        // Add command for the new view
        this.addCommand({
            id: 'show-manuscript-timeline',
            name: 'Show Manuscript Timeline',
            callback: async () => {
                await this.activateView();
            }
        });

        // Add settings tab
        this.addSettingTab(new ManuscriptTimelineSettingTab(this.app, this));

        // Add message listener for file opening
        window.addEventListener('message', async (event) => {
            if (event.data.type === 'open-file') {
                const file = this.app.vault.getAbstractFileByPath(event.data.path);
                if (file instanceof TFile) {
                    await this.app.workspace.getLeaf().openFile(file);
                }
            }
        });

        // Register event listeners to refresh the timeline when files change
        this.registerEvent(
            this.app.vault.on('modify', (file) => this.refreshTimelineIfNeeded(file))
        );
        this.registerEvent(
            this.app.vault.on('delete', (file) => this.refreshTimelineIfNeeded(file))
        );
        this.registerEvent(
            this.app.vault.on('create', (file) => this.refreshTimelineIfNeeded(file))
        );
        this.registerEvent(
            this.app.vault.on('rename', (file) => this.refreshTimelineIfNeeded(file))
        );
        
        // Add event listener for metadata cache changes
        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => this.refreshTimelineIfNeeded(file))
        );

        // Add command to open the timeline view
        this.addCommand({
            id: 'open-manuscript-timeline-view',
            name: 'Open Timeline View',
            callback: () => this.activateView()
        });
    }
    
    // Helper to activate the timeline view
    async activateView() {
        // Check if view already exists
        const leaves = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
        
        if (leaves.length > 0) {
            // View exists, just reveal it
            this.app.workspace.revealLeaf(leaves[0]);
            return;
        }
        
        // Create a new leaf in the center (main editor area)
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({
            type: TIMELINE_VIEW_TYPE,
            active: true
        });
        
        // Reveal the leaf
        this.app.workspace.revealLeaf(leaf);
    }

    // Method to generate timeline (legacy HTML method - will be removed later)

    // Public method to get scene data
    async getSceneData(): Promise<Scene[]> {
        // Find markdown files in vault that match the filters
        const files = this.app.vault.getMarkdownFiles().filter(file => {
            // If sourcePath is empty, include all files, otherwise only include files in the sourcePath
            if (this.settings.sourcePath) {
                return file.path.startsWith(this.settings.sourcePath);
            }
            return true;
        });

        const scenes: Scene[] = [];
    
        for (const file of files) {
            try {
            const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
                
                if (metadata && metadata.Class === "Scene") {
                // Fix for date shift issue - ensure dates are interpreted as UTC
                const whenStr = metadata.When;
                
                // Directly parse the date in a way that preserves the specified date regardless of timezone
                // Use a specific time (noon UTC) to avoid any date boundary issues
                const when = new Date(`${whenStr}T12:00:00Z`);
                
                if (!isNaN(when.getTime())) {
                    // Split subplots if provided, otherwise default to "Main Plot"
                    const subplots = metadata.Subplot
                        ? Array.isArray(metadata.Subplot) 
                            ? metadata.Subplot 
                            : [metadata.Subplot]
                        : ["Main Plot"];
                    
                    // Read actNumber from metadata, default to 1 if missing
                    const actNumber = metadata.Act !== undefined ? Number(metadata.Act) : 1;
    
                    // Ensure actNumber is a valid number between 1 and 3
                    const validActNumber = (actNumber >= 1 && actNumber <= 3) ? actNumber : 1;
    
                    // Parse Character metadata - it might be a string or array
                    let characters = metadata.Character;
                    if (characters) {
                        // Convert to array if it's a string
                        if (!Array.isArray(characters)) {
                            characters = [characters];
                        }
                        // Clean up the internal link format (remove [[ and ]])
                        characters = characters.map((char: string) => char.replace(/[\[\]]/g, ''));
                        } else {
                            characters = [];
                    }
    
                    // Create a separate entry for each subplot
                    subplots.forEach(subplot => {
                        scenes.push({
                            title: metadata.Title || file.basename,
                                date: when.toISOString(),
                                path: file.path,
                            subplot: subplot,
                                act: validActNumber.toString(),
                                characters: characters,
                                pov: metadata.Pov,
                                location: metadata.Place,
                                number: validActNumber,
                                synopsis: metadata.Synopsis,
                                when: when,
                            actNumber: validActNumber,
                                Character: characters,
                                status: metadata.Status,
                                "Publish Stage": metadata["Publish Stage"],
                                due: metadata.Due,
                                Edits: metadata.Edits
                            });

                            // Only log scene data in debug mode, and avoid the noisy scene details
                            if (this.settings.debug) {
                                this.log(`Added scene: ${metadata.Title || file.basename}`);
                            }
                    });
                }
            }
            } catch (error) {
                console.error(`Error processing file ${file.path}:`, error);
        }
        }

        //sort scenes by when and then by scene number for the subplot radials
        return scenes.sort((a, b) => {
            // First compare by when (date)
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            const whenComparison = dateA.getTime() - dateB.getTime();
            if (whenComparison !== 0) return whenComparison;
            
            // If dates are equal, compare by scene number
            const aNumber = parseSceneTitle(a.title || '').number;
            const bNumber = parseSceneTitle(b.title || '').number;
            
            // Convert scene numbers to numbers for comparison
            // Ensure we're using numeric values by explicitly parsing the strings
            const aNumberValue = aNumber ? parseInt(aNumber, 10) : 0;
            const bNumberValue = bNumber ? parseInt(bNumber, 10) : 0;
            return aNumberValue - bNumberValue;
        });
    }

    // Change from private to public
    public createTimelineSVG(scenes: Scene[]): string {
        const size = 1600;
        const margin = 30;
        const innerRadius = 200; // the first ring is 200px from the center
        const outerRadius = size / 2 - margin;
    
        // Create a map to store scene number information for the scene square and synopsis
        const sceneNumbersMap = new Map<string, SceneNumberInfo>();
    
        // Collect all unique subplots
        const allSubplotsSet = new Set<string>();
        scenes.forEach(scene => {
            allSubplotsSet.add(scene.subplot || "None");
        });
        const allSubplots = Array.from(allSubplotsSet);
    
        // Dynamically set NUM_RINGS based on the number of unique subplots
        const NUM_RINGS = allSubplots.length;
    
        const DEFAULT_RING_COLOR = '#333333'; // Dark gray
    
        // Group scenes by Act and Subplot
        const scenesByActAndSubplot: { [act: number]: { [subplot: string]: Scene[] } } = {};
    
        for (let act = 0; act < NUM_ACTS; act++) {
            scenesByActAndSubplot[act] = {};
        }
    
        scenes.forEach(scene => {
            const act = scene.actNumber !== undefined ? scene.actNumber - 1 : 0; // Subtract 1 for 0-based index, default to 0 if undefined
    
            // Ensure act is within valid range
            const validAct = (act >= 0 && act < NUM_ACTS) ? act : 0;
    
            const subplot = scene.subplot || 'Default';
    
            if (!scenesByActAndSubplot[validAct][subplot]) {
                scenesByActAndSubplot[validAct][subplot] = [];
            }
    
            scenesByActAndSubplot[validAct][subplot].push(scene);
        });
    
        // Define the months and their angles
        const months = Array.from({ length: 12 }, (_, i) => {
            const angle = (i / 12) * 2 * Math.PI - Math.PI / 2; // Adjust so January is at the top
            const name = new Date(2000, i).toLocaleString('en-US', { month: 'long' });
            const shortName = new Date(2000, i).toLocaleString('en-US', { month: 'short' }).slice(0, 3);
            return { name, shortName, angle };
        });
    
        // Calculate total available space
        const availableSpace = outerRadius - innerRadius;
    
        // Set the reduction factor for ring widths (if you want equal widths, set reductionFactor to 1)
        const reductionFactor = 1; // For equal ring widths
        const N = NUM_RINGS;
    
        // Calculate the sum of the geometric series (simplifies to N when reductionFactor is 1)
        const sumOfSeries = (reductionFactor === 1) ? N : (1 - Math.pow(reductionFactor, N)) / (1 - reductionFactor);
    
        // Calculate the initial ring width to fill the available space
        const initialRingWidth = availableSpace / sumOfSeries;
    
        // Calculate each ring's width
        const ringWidths = Array.from({ length: N }, (_, i) => initialRingWidth * Math.pow(reductionFactor, i));
    
        // Calculate the start radii for each ring
        const ringStartRadii = ringWidths.reduce((acc, width, i) => {
            const previousRadius = i === 0 ? innerRadius : acc[i - 1] + ringWidths[i - 1];
            acc.push(previousRadius);
            return acc;
        }, [] as number[]);
    
        // Months radius outer and inner
        const lineInnerRadius = ringStartRadii[0] - 20;
        const lineOuterRadius = ringStartRadii[N - 1] + ringWidths[N - 1] + 30;
    
        // **Include the `<style>` code here**
        let svg = `<svg width="${size}" height="${size}" viewBox="-${size / 2} -${size / 2} ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="background-color: transparent;">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;900&display=swap');

            svg {
                font-family: 'Lato', sans-serif;
                background-color: transparent;
            }

            .scene-title {
                fill: white;
                opacity: 1;
                pointer-events: none;
            }

            .scene-title.faded {
                fill: var(--text-muted, #666666);
                opacity: 0.2;
            }

            .center-number-text {
                fill: var(--text-normal, #333333);
                font-size: 140px;
                pointer-events: none;
                font-weight: 900;
            }

            .scene-act {
                fill-opacity: 0;
                transition: fill-opacity 0.2s;
            }

            .scene-act:hover {
                fill-opacity: 0.3;
                cursor: pointer;
            }

            .scene-info {
                opacity: 0;
                transition: opacity 0.2s;
                pointer-events: none;
            }

            .scene-group:hover .scene-info {
                opacity: 1;
            }

            .number-text {
                font-size: 14px;
                pointer-events: none;
            }

            .number-text.faded {
                opacity: 0.2;
            }

            .number-square {
                opacity: 1;
                pointer-events: none;
            }

            .number-square.faded {
                opacity: 0.2;
            }

            .scene-path {
                opacity: 1;
                transition: opacity 0.2s ease-out;
                pointer-events: all;
            }

            .scene-path.faded {
                opacity: 0.5;
                transition: opacity 0.2s ease-out;
            }

            .scene-path.highlighted {
                opacity: 1;
                transition: opacity 0.2s ease-out;
            }

            .info-title {
                fill: var(--text-normal, #333333);
                font-size: 28px;
                text-anchor: middle;
            }

            .subplot-text {
                fill: var(--text-normal, #333333);
                font-size: 28px;
                text-anchor: middle;
            }

            .synopsis-text {
                fill: var(--text-normal, #333333);
                font-size: 28px;
                text-anchor: middle;
            }

            .month-label {
                fill: var(--text-normal, #333333);
                font-size: 16px;
                pointer-events: none;
                dominant-baseline: middle;
            }

            .month-label-outer {
                fill: var(--text-normal, #333333);
                font-size: 20px;
                pointer-events: none;
                dominant-baseline: middle;
            }

            .act-label {
                fill: var(--text-normal, #333333);
                font-size: 20px;
                font-weight: bold;
                pointer-events: none;
                dominant-baseline: middle;
            }

            .info-container {
                fill: var(--text-normal, #333333);
                font-size: 24px;
            }

            .info-text {
                dominant-baseline: hanging;
                text-anchor: start;
                fill: var(--text-normal, #333333);
            }
            
            .key-text {
                fill: var(--text-normal, #333333);
                font-size: 16px;
                transition: fill 0.2s ease;
            }
            
            // Add CSS classes for month spokes in the SVG style section
            .month-spoke-line {
                stroke: var(--text-normal, #333333);
                stroke-width: 1;
            }

            .month-spoke-line.act-boundary {
                stroke: var(--text-accent, #705dcf);
                stroke-width: 3;
            }
            
            // Add CSS classes for act borders and progress ring
            .act-border {
                stroke: var(--text-accent, #705dcf);
                stroke-width: 5;
                fill: none;
            }

            .progress-ring-base {
                stroke: var(--background-modifier-border, #dddddd);
                stroke-width: 10;
                fill: none;
            }

            .progress-ring-fill {
                /* Stroke color is applied via gradient in the SVG */
                stroke-width: 10;
                fill: none;
            }
            
            /* Ensure key-text elements are styled correctly */
            .theme-dark .key-text {
                fill: #ffffff !important;
            }
            
            .theme-light .key-text {
                fill: #333333 !important;
            }
            
            /* Always keep info-text dark for better visibility against light background */
            .info-text {
                fill: #333333 !important;
            }

            .color-key-center {
                opacity: 1;
                pointer-events: none;
            }

            .center-key-text {
                fill: var(--text-normal, #333333);
                font-size: 18px;
                text-transform: uppercase;
                opacity: 0.85; /* Slightly transparent */
            }
        </style>`;

        // Access the publishStageColors from settings
        const PUBLISH_STAGE_COLORS = this.settings.publishStageColors;

        // Begin defs act
        svg += `<defs>`;
        
        // Define plaid patterns for Working and Todo status
        svg += `<pattern id="plaidWorking" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="${this.darkenColor(STATUS_COLORS.Working, 10)}"/>
            <line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff" stroke-width="2.5" stroke-opacity="0.6"/>
            <line x1="0" y1="0" x2="10" y2="0" stroke="#ffffff" stroke-width="2.5" stroke-opacity="0.6"/>
        </pattern>`;
        
        svg += `<pattern id="plaidTodo" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="${this.lightenColor(STATUS_COLORS.Todo, 15)}"/>
            <line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff" stroke-width="1" stroke-opacity="0.3"/>
            <line x1="0" y1="0" x2="10" y2="0" stroke="#ffffff" stroke-width="1" stroke-opacity="0.3"/>
        </pattern>`;
        
        // Define patterns for Working and Todo states with Publish Stage colors
        svg += `${Object.entries(PUBLISH_STAGE_COLORS).map(([stage, color]) => `
            <pattern id="plaidWorking${stage}" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="${this.darkenColor(color, 10)}"/>
                <line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff" stroke-width="2.5" stroke-opacity="0.6"/>
                <line x1="0" y1="0" x2="10" y2="0" stroke="#ffffff" stroke-width="2.5" stroke-opacity="0.6"/>
            </pattern>
            
            <pattern id="plaidTodo${stage}" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="${this.lightenColor(color, 20)}"/>
                <line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff" stroke-width="1" stroke-opacity="0.3"/>
                <line x1="0" y1="0" x2="10" y2="0" stroke="#ffffff" stroke-width="1" stroke-opacity="0.3"/>
            </pattern>
        `).join('')}`;
        
        // Define outer arc paths for months
        months.forEach(({ name, angle }, index) => {
            // Calculate angular offset for 9px at the label radius
            const outerlabelRadius = lineOuterRadius - 15; //the larger the number the closer to the center
            // Convert 5px to radians based on the circle's circumference
            const pixelToRadian = (5 * 2 * Math.PI) / (2 * Math.PI * outerlabelRadius);
            
            // Make the month offset very small, similar to but positive (clockwise) for Acts
            const angleOffset = 0.01; // Half of previous value (0.02)
            const startAngle = angle + angleOffset;  // Small offset to move label clockwise
            const endAngle = startAngle + (Math.PI / 24); // Short arc length
  
            const pathId = `monthLabelPath-${index}`;

            svg += `
                <path id="${pathId}"
                    d="
                        M ${formatNumber(outerlabelRadius * Math.cos(startAngle))} ${formatNumber(outerlabelRadius * Math.sin(startAngle))}
                        A ${formatNumber(outerlabelRadius)} ${formatNumber(outerlabelRadius)} 0 0 1 ${formatNumber(outerlabelRadius * Math.cos(endAngle))} ${formatNumber(outerlabelRadius * Math.sin(endAngle))}
                    "
                    fill="none"
                />
            `;
        });

        // Close defs act
        svg += `</defs>`;

        //outer months Labels
        months.forEach(({ name }, index) => {
            const pathId = `monthLabelPath-${index}`;
            svg += `
                <text class="month-label-outer">
                    <textPath href="#${pathId}" startOffset="0" text-anchor="start">
                        ${name}
                    </textPath>
                </text>
            `;
        });

        // First add the progress ring (move this BEFORE the month spokes code)
        // Calculate year progress
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const yearProgress = (now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24 * 365);

        // Create progress ring
        const progressRadius = lineInnerRadius + 15;
        const circumference = 2 * Math.PI * progressRadius;
        const progressLength = circumference * yearProgress;
        const startAngle = -Math.PI / 2; // Start at 12 o'clock
        const endAngle = startAngle + (2 * Math.PI * yearProgress);

        // Define rainbow gradients for the segments
        svg += `<defs>
            <linearGradient id="linearColors1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#FF0000"></stop>
                <stop offset="100%" stop-color="#FF7F00"></stop>
            </linearGradient>
            <linearGradient id="linearColors2" x1="0.5" y1="0" x2="0.5" y2="1">
                <stop offset="0%" stop-color="#FF7F00"></stop>
                <stop offset="100%" stop-color="#FFFF00"></stop>
            </linearGradient>
            <linearGradient id="linearColors3" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#FFFF00"></stop>
                <stop offset="100%" stop-color="#00FF00"></stop>
            </linearGradient>
            <linearGradient id="linearColors4" x1="1" y1="1" x2="0" y2="0">
                <stop offset="0%" stop-color="#00FF00"></stop>
                <stop offset="100%" stop-color="#0000FF"></stop>
            </linearGradient>
            <linearGradient id="linearColors5" x1="0.5" y1="1" x2="0.5" y2="0">
                <stop offset="0%" stop-color="#0000FF"></stop>
                <stop offset="100%" stop-color="#4B0082"></stop>
            </linearGradient>
            <linearGradient id="linearColors6" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stop-color="#4B0082"></stop>
                <stop offset="100%" stop-color="#8F00FF"></stop>
            </linearGradient>
        </defs>`;

        // Add the base gray circle
        svg += `
            <circle
                cx="0"
                cy="0"
                r="${progressRadius}"
                class="progress-ring-base"
            />
        `;

        // Create six segments for the rainbow
        const segmentCount = 6;
        const fullCircleAngle = 2 * Math.PI;
        const segmentAngle = fullCircleAngle / segmentCount;
        
        // Calculate how many complete segments to show based on year progress
        const completeSegments = Math.floor(yearProgress * segmentCount);
        
        // Calculate the partial segment angle (for the last visible segment)
        const partialSegmentAngle = (yearProgress * segmentCount - completeSegments) * segmentAngle;
        
        // Draw each segment that should be visible
        for (let i = 0; i < segmentCount; i++) {
            // Calculate this segment's start and end angles
            const segStart = startAngle + (i * segmentAngle);
            let segEnd = segStart + segmentAngle;
            
            // If this is beyond what should be shown based on year progress, skip it
            if (i > completeSegments) continue;
            
            // If this is the last partial segment, adjust the end angle
            if (i === completeSegments && partialSegmentAngle > 0) {
                segEnd = segStart + partialSegmentAngle;
            }
            
            // Create the arc path for this segment
            svg += `
                <path
                    d="
                        M ${progressRadius * Math.cos(segStart)} ${progressRadius * Math.sin(segStart)}
                        A ${progressRadius} ${progressRadius} 0 ${(segEnd - segStart) > Math.PI ? 1 : 0} 1 
                        ${progressRadius * Math.cos(segEnd)} ${progressRadius * Math.sin(segEnd)}
                    "
                    class="progress-ring-fill"
                    stroke="url(#linearColors${i+1})"
                />
            `;
        }

        // THEN add the month spokes group (existing code)
        svg += `<g class="month-spokes">`;
        
        // For each month, draw the inner spoke and labels
 
        // Then modify the inner month labels to curve along the inner arc
        months.forEach(({ name, angle }, monthIndex) => {
            const x1 = formatNumber((lineInnerRadius - 5) * Math.cos(angle));
            const y1 = formatNumber((lineInnerRadius - 5) * Math.sin(angle));
            const x2 = formatNumber(lineOuterRadius * Math.cos(angle));
            const y2 = formatNumber(lineOuterRadius * Math.sin(angle));

            // Check if this is an Act boundary (months 0, 4, or 8)
            const isActBoundary = [0, 4, 8].includes(monthIndex);

            // Draw the spoke line
            svg += `
                <line  
                    x1="${x1}"
                    y1="${y1}"
                    x2="${x2}"
                    y2="${y2}"
                    class="month-spoke-line${isActBoundary ? ' act-boundary' : ''}"
                />`;

            // Create curved path for inner month labels
            const innerLabelRadius = lineInnerRadius;
            const pixelToRadian = (5 * 2 * Math.PI) / (2 * Math.PI * innerLabelRadius);
            const startAngle = angle + pixelToRadian;
            const endAngle = angle + (Math.PI / 6);
            
            const innerPathId = `innerMonthPath-${name}`;
            
            svg += `
                <path id="${innerPathId}"
                    d="
                        M ${formatNumber(innerLabelRadius * Math.cos(startAngle))} ${formatNumber(innerLabelRadius * Math.sin(startAngle))}
                        A ${formatNumber(innerLabelRadius)} ${formatNumber(innerLabelRadius)} 0 0 1 ${formatNumber(innerLabelRadius * Math.cos(endAngle))} ${formatNumber(innerLabelRadius * Math.sin(endAngle))}
                    "
                    fill="none"
                />
                <text class="month-label">
                    <textPath href="#${innerPathId}" startOffset="0" text-anchor="start">
                        ${months[monthIndex].shortName}
                    </textPath>
                </text>
            `;
        });

         // Close the month spokes lines and text labels group
        svg += `</g>`;

        // Create master subplot order before the act loop
        const masterSubplotOrder = (() => {
            // Create a combined set of all subplots from all acts
            const allSubplotsMap = new Map<string, number>();
            
            // Iterate through all acts to gather all subplots
            for (let actIndex = 0; actIndex < NUM_ACTS; actIndex++) {
                Object.entries(scenesByActAndSubplot[actIndex] || {}).forEach(([subplot, scenes]) => {
                    // Add scenes count to existing count or initialize
                    allSubplotsMap.set(subplot, (allSubplotsMap.get(subplot) || 0) + scenes.length);
                });
            }
            
            // Convert map to array of subplot objects
            const subplotCounts = Array.from(allSubplotsMap.entries()).map(([subplot, count]) => ({
                subplot,
                count
            }));

            // Sort subplots, but ensure "Main Plot" or empty subplot is first
            subplotCounts.sort((a, b) => {
                // If either subplot is "Main Plot" or empty, prioritize it
                if (a.subplot === "Main Plot" || !a.subplot) return -1;
                if (b.subplot === "Main Plot" || !b.subplot) return 1;
                // Otherwise, sort by count as before
                return b.count - a.count;
            });

            return subplotCounts.map(item => item.subplot);
        })();

        // Synopses at end to be above all other elements
        const synopsesHTML: string[] = [];
        scenes.forEach((scene) => {
            // Handle undefined subplot with a default "Main Plot"
            const subplot = scene.subplot || "Main Plot";
            const subplotIndex = masterSubplotOrder.indexOf(subplot);
            const ring = NUM_RINGS - 1 - subplotIndex;
            
            // Handle undefined actNumber with a default of 1
            const actNumber = scene.actNumber !== undefined ? scene.actNumber : 1;
            
            // Get the scenes for this act and subplot to determine correct index
            const sceneActNumber = scene.actNumber !== undefined ? scene.actNumber : 1;
            const actIndex = sceneActNumber - 1;
            const scenesInActAndSubplot = (scenesByActAndSubplot[actIndex] && scenesByActAndSubplot[actIndex][subplot]) || [];
            const sceneIndex = scenesInActAndSubplot.indexOf(scene);
            
            const sceneId = `scene-path-${actIndex}-${ring}-${sceneIndex}`;
            const numberInfo = sceneNumbersMap.get(sceneId);
            
            const lineHeight = 30;
            const size = 1600;
            const maxTextWidth = 500;
            const topOffset = -size / 2;

            // Generate random colors for characters
            const characterColors = scene.Character?.map(char => 
                '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
            ) || [];

            // Find all subplots this scene belongs to
            const allSceneSubplots = scenes
                .filter(s => s.path === scene.path)
                .map(s => s.subplot);

            // Reorder subplots to put the current ring's subplot first
            const orderedSubplots = [
                scene.subplot,
                ...allSceneSubplots.filter(s => s !== scene.subplot)
            ];

            // Prepare text content with modified format
            const synopsisLines = scene.synopsis ? 
                this.splitIntoBalancedLines(scene.synopsis, maxTextWidth) : [];

            const contentLines = [
                `${scene.title} - ${scene.when?.toLocaleDateString()}`,
                ...synopsisLines,
                // Add a non-breaking space to preserve the line spacing
                '\u00A0', // Using non-breaking space instead of empty string
                // Subplots with bullet-like separator
                orderedSubplots.map((subplot, i) => 
                    `<tspan style="font-size: 17px; fill: #555555; text-transform: uppercase; font-weight: bold;">${subplot}</tspan>`
                ).join(`<tspan style="font-size: 17px; fill: #555555;"> • </tspan>`),
                // Characters with bullets between them
                scene.Character && scene.Character.length > 0 ? 
                    scene.Character.map((char, i) => 
                        `<tspan style="fill: ${characterColors[i]}; font-size: 14px;">${char.toUpperCase()}</tspan>`
                    ).join(`<tspan style="fill: ${characterColors[0]}; font-size: 14px;"> • </tspan>`) : '',
            ].filter(line => line);

            const totalHeight = contentLines.length * lineHeight;

            // Determine which text block to show based on Act number
            const displayActNumber = scene.actNumber !== undefined ? scene.actNumber : 1;
            const showLeftText = displayActNumber <= 2;
            const showRightText = displayActNumber === 3;

            synopsesHTML.push(`
                <g class="scene-info info-container" 
                   style="opacity: 0; pointer-events: none;" 
                   data-for-scene="${sceneId}">
                    ${showLeftText ? `
                    <!-- Left side text block -->
                    <g transform="translate(-650, -400)">
                        ${contentLines.map((line, i) => `
                            <text class="info-text" x="10" y="${i * lineHeight}"
                                style="${i === 0 ? 'font-size: 24px; font-weight: bold;' : ''}"
                            >${line}</text>
                        `).join('')}
                    </g>
                    ` : ''}

                    ${showRightText ? `
                    <!-- Right side text block -->
                    <g transform="translate(-300, 250)">
                        ${contentLines.map((line, i) => `
                            <text class="info-text" x="0" y="${i * lineHeight}"
                                style="${i === 0 ? 'font-size: 24px; font-weight: bold;' : ''}"
                                text-anchor="middle"
                            >${line}</text>
                        `).join('')}
                    </g>
                    ` : ''}
                </g>
            `);
        });

        // Draw scenes and dummy scenes (existing code remains as is)
        for (let act = 0; act < NUM_ACTS; act++) {
            const totalRings = NUM_RINGS;
            const subplotCount = masterSubplotOrder.length;
            const ringsToUse = Math.min(subplotCount, totalRings);

            for (let ringOffset = 0; ringOffset < ringsToUse; ringOffset++) {
                const ring = totalRings - ringOffset - 1; // Start from the outermost ring
                
                const innerR = ringStartRadii[ring];
                const outerR = innerR + ringWidths[ring];
                
                const startAngle = (act * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
                const endAngle = ((act + 1) * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
                
                // Use the subplot from the master order instead of the current act's order
                const subplot = masterSubplotOrder[ringOffset];
                
                if (subplot) {
                    const currentScenes = scenesByActAndSubplot[act][subplot] || [];

                    if (currentScenes && currentScenes.length > 0) {
                        const sceneAngleSize = (endAngle - startAngle) / currentScenes.length;
            
                        currentScenes.forEach((scene, idx) => {
                            const { number, text } = parseSceneTitle(scene.title || '');
                            const sceneStartAngle = startAngle + (idx * sceneAngleSize);
                            const sceneEndAngle = sceneStartAngle + sceneAngleSize;
                            const textPathRadius = (innerR + outerR) / 2;
            
                            // Determine the color of a scene based on its status and due date
                            const color = (() => {
                                const statusList = Array.isArray(scene.status) ? scene.status : [scene.status];
                                const normalizedStatus = statusList[0]?.toString().trim().toLowerCase() || '';
                                
                                // Get the publish stage for pattern selection
                                const publishStage = scene["Publish Stage"] || 'Zero';
                                
                                if (normalizedStatus === "complete") {
                                    // For completed scenes, use Publish Stage color with full opacity
                                    const stageColor = PUBLISH_STAGE_COLORS[publishStage as keyof typeof PUBLISH_STAGE_COLORS] || PUBLISH_STAGE_COLORS.Zero;
                                    // Do not apply any modifications to the color to ensure it matches the legend
                                    return stageColor;
                                }
                                if (scene.due && new Date() > new Date(scene.due)) {
                                    return STATUS_COLORS.Due; // Use Due color if past due date
                                }
                                
                                // Check for working or todo status to use plaid pattern
                                if (normalizedStatus === "working") {
                                    return `url(#plaidWorking${publishStage})`;
                                }
                                if (normalizedStatus === "todo") {
                                    return `url(#plaidTodo${publishStage})`;
                                }
                                
                                return STATUS_COLORS[statusList[0] as keyof typeof STATUS_COLORS] || STATUS_COLORS.Todo; // Use status color or default to Todo
                            })();
            
                        
                            // Construct the arc path for the scene
                            const arcPath = `
                                M ${formatNumber(innerR * Math.cos(sceneStartAngle))} ${formatNumber(innerR * Math.sin(sceneStartAngle))}
                                L ${formatNumber(outerR * Math.cos(sceneStartAngle))} ${formatNumber(outerR * Math.sin(sceneStartAngle))}
                                A ${formatNumber(outerR)} ${formatNumber(outerR)} 0 0 1 ${formatNumber(outerR * Math.cos(sceneEndAngle))} ${formatNumber(outerR * Math.sin(sceneEndAngle))}
                                L ${formatNumber(innerR * Math.cos(sceneEndAngle))} ${formatNumber(innerR * Math.sin(sceneEndAngle))}
                                A ${formatNumber(innerR)} ${formatNumber(innerR)} 0 0 0 ${formatNumber(innerR * Math.cos(sceneStartAngle))} ${formatNumber(innerR * Math.sin(sceneStartAngle))}
                            `;
            
                            const sceneId = `scene-path-${act}-${ring}-${idx}`;
            
                            // In createTimelineSVG method, replace the font size calculation with a fixed size:
                            const fontSize = 18; // Fixed font size for all rings
                            const dyOffset = -1; // Small negative offset to align with top curve with 1px padding
            
                            svg += `
                            <g class="scene-group" data-path="${scene.path ? encodeURIComponent(scene.path) : ''}" id="scene-group-${act}-${ring}-${idx}">
                                <path id="${sceneId}"
                                      d="${arcPath}" 
                                      fill="${color}" 
                                      stroke="white" 
                                      stroke-width="1" 
                                      class="scene-path"/>

                                <!-- Scene title path (using only the text part) -->
                                <path id="textPath-${act}-${ring}-${idx}" 
                                      d="M ${formatNumber(textPathRadius * Math.cos(sceneStartAngle + 0.02))} ${formatNumber(textPathRadius * Math.sin(sceneStartAngle + 0.02))} 
                                         A ${formatNumber(textPathRadius)} ${formatNumber(textPathRadius)} 0 0 1 ${formatNumber(textPathRadius * Math.cos(sceneEndAngle))} ${formatNumber(textPathRadius * Math.sin(sceneEndAngle))}" 
                                      fill="none"/>
                                <text class="scene-title" style="font-size: ${fontSize}px" dy="${dyOffset}">
                                    <textPath href="#textPath-${act}-${ring}-${idx}" startOffset="4">
                                        ${text}
                                    </textPath>
                                </text>
                            </g>`;
                        });
                    } else {
                        // Create 4 dummy scenes for empty subplot rings
                        const dummyScenes = 4;
                        for (let idx = 0; idx < dummyScenes; idx++) {
                            const sceneStartAngle = startAngle + (idx * (endAngle - startAngle) / dummyScenes);
                            const sceneEndAngle = startAngle + ((idx + 1) * (endAngle - startAngle) / dummyScenes);
                            
                            // Construct the arc path for the dummy scene
                            const arcPath = `
                                M ${formatNumber(innerR * Math.cos(sceneStartAngle))} ${formatNumber(innerR * Math.sin(sceneStartAngle))}
                                L ${formatNumber(outerR * Math.cos(sceneStartAngle))} ${formatNumber(outerR * Math.sin(sceneStartAngle))}
                                A ${formatNumber(outerR)} ${formatNumber(outerR)} 0 0 1 ${formatNumber(outerR * Math.cos(sceneEndAngle))} ${formatNumber(outerR * Math.sin(sceneEndAngle))}
                                L ${formatNumber(innerR * Math.cos(sceneEndAngle))} ${formatNumber(innerR * Math.sin(sceneEndAngle))}
                                A ${formatNumber(innerR)} ${formatNumber(innerR)} 0 0 0 ${formatNumber(innerR * Math.cos(sceneStartAngle))} ${formatNumber(innerR * Math.sin(sceneStartAngle))}
                            `;

                            svg += `<path d="${arcPath}" 
                                     fill="${this.lightenColor(PUBLISH_STAGE_COLORS.Zero, 50)}" 
                                     stroke="white" 
                                     stroke-width="1" 
                                     class="scene-path"/>`;
                        }
                    }
                } else {
                    // Empty subplot code
                    const arcPath = `
                        M ${formatNumber(innerR * Math.cos(startAngle))} ${formatNumber(innerR * Math.sin(startAngle))}
                        L ${formatNumber(outerR * Math.cos(startAngle))} ${formatNumber(outerR * Math.sin(startAngle))}
                        A ${formatNumber(outerR)} ${formatNumber(outerR)} 0 0 1 ${formatNumber(outerR * Math.cos(endAngle))} ${formatNumber(outerR * Math.sin(endAngle))}
                        L ${formatNumber(innerR * Math.cos(endAngle))} ${formatNumber(innerR * Math.sin(endAngle))}
                        A ${formatNumber(innerR)} ${formatNumber(innerR)} 0 0 0 ${formatNumber(innerR * Math.cos(startAngle))} ${formatNumber(innerR * Math.sin(startAngle))}
                    `;
                    const emptyColor = this.lightenColor(PUBLISH_STAGE_COLORS.Zero, 50); // Lighter purple/Zero color
                    svg += `<path d="${arcPath}" fill="${emptyColor}" stroke="white" stroke-width="1"/>`;
                }
            }
        }

        // After all scenes are drawn, add just the act borders (vertical lines only)
        for (let act = 0; act < NUM_ACTS; act++) {
            const angle = (act * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
            
            // Draw only the vertical line (y-axis spoke) for each act boundary
            svg += `<line 
                x1="${formatNumber(innerRadius * Math.cos(angle))}" 
                y1="${formatNumber(innerRadius * Math.sin(angle))}"
                x2="${formatNumber(outerRadius * Math.cos(angle))}" 
                y2="${formatNumber(outerRadius * Math.sin(angle))}"
                class="act-border"
            />`;
        }

        // Calculate the actual outermost outerRadius (first ring's outer edge)
        const actualOuterRadius = ringStartRadii[NUM_RINGS - 1] + ringWidths[NUM_RINGS - 1];
       
        // Remove the old act code and replace it with this new version:
        for (let act = 0; act < NUM_ACTS; act++) {
            // Calculate angle for each act's starting position
            const angle = (act * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
            
            // Position labels slightly to the left of the vertical borders
            const actLabelRadius = actualOuterRadius + 14;
            const angleOffset = -0.08; // Positive offset moves text clockwise
            
            // Calculate start and end angles for the curved path
            const startAngle = angle + angleOffset;
            const endAngle = startAngle + (Math.PI / 12); // Reduced arc length
            
            const actPathId = `actPath-${act}`;
            
            // Create the curved path for act label
            svg += `
                <path id="${actPathId}"
                    d="
                        M ${formatNumber(actLabelRadius * Math.cos(startAngle))} ${formatNumber(actLabelRadius * Math.sin(startAngle))}
                        A ${formatNumber(actLabelRadius)} ${formatNumber(actLabelRadius)} 0 0 1 ${formatNumber(actLabelRadius * Math.cos(endAngle))} ${formatNumber(actLabelRadius * Math.sin(endAngle))}
                    "
                    fill="none"
                />
                <text class="act-label">
                    <textPath href="#${actPathId}" startOffset="0" text-anchor="start">
                        ACT ${act + 1}
                    </textPath>
                </text>
            `;
        }

        // Add color key with decorative elements
        const keyX = size/2 - 200; // Position from right edge
        const keyY = -size/2 + 50; // Position from top
        const swatchSize = 20;
        const textOffset = 30;
        const lineHeight = 30;

        // Calculate the number of scenes for each status using a Set to track unique scenes
        const processedScenes = new Set<string>(); // Track scenes by their path
        const statusCounts = scenes.reduce((acc, scene) => {
            // Skip if we've already processed this scene
            if (scene.path && processedScenes.has(scene.path)) {
                return acc;
            }
            
            // Mark scene as processed
            if (scene.path) {
                processedScenes.add(scene.path);
            }
            
            const normalizedStatus = scene.status?.toString().trim().toLowerCase() || '';
            
            if (normalizedStatus === "complete") {
                // For completed scenes, count by Publish Stage
                const publishStage = scene["Publish Stage"] || 'Zero';
                // Use the publishStage directly with type safety
                const validStage = publishStage as keyof typeof PUBLISH_STAGE_COLORS;
                acc[validStage] = (acc[validStage] || 0) + 1;
            } else if (scene.due && new Date() > new Date(scene.due)) {
                // Non-complete scenes that are past due date are counted as Due
                acc["Due"] = (acc["Due"] || 0) + 1;
            } else {
                // All other scenes are counted by their status
                // First get the status as a string safely
                let statusKey = "Todo"; // Default to Todo
                
                if (scene.status) {
                    if (Array.isArray(scene.status) && scene.status.length > 0) {
                        statusKey = String(scene.status[0]);
                    } else if (typeof scene.status === 'string') {
                        statusKey = scene.status;
                    }
                }
                
                acc[statusKey] = (acc[statusKey] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);

        // Add center color key
        const centerRadius = innerRadius * 0.7; // Slightly smaller than innerRadius
        const centerKeySize = 20; // Size of color swatches
        const centerLineHeight = 35;

        // Separate stage colors and status colors
        const stageColorEntries = Object.entries(PUBLISH_STAGE_COLORS);
        const statusColorEntries = Object.entries(STATUS_COLORS)
            .filter(([status]) => status !== 'Empty' && status !== 'Complete');

        // Calculate heights for alignment
        const maxEntries = Math.max(stageColorEntries.length, statusColorEntries.length);
        const totalHeight = maxEntries * centerLineHeight;
        const startY = -totalHeight / 2 + centerLineHeight / 2;

        svg += `
            <g class="color-key-center">
                <!-- Stage colors column (left) -->
                ${stageColorEntries.map(([stage, color], index) => {
                    const yPos = startY + (index * centerLineHeight);
                    return `
                        <g transform="translate(-25, ${yPos})">
                            <!-- Stage label with right justification -->
                            <text 
                                x="-10" 
                                y="0" 
                                dominant-baseline="middle" 
                                text-anchor="end"
                                class="center-key-text"
                            >${stage.toUpperCase()} <tspan style="font-size: 14px; opacity: 0.7; baseline-shift: super;">${statusCounts[stage] || 0}</tspan></text>
                            
                            <!-- Color SWATCH to the right of text -->
                            <rect 
                                x="-3" 
                                y="-13" 
                                width="25" 
                                height="25" 
                                fill="${color}"
                            />
                        </g>
                    `;
                }).join('')}

                <!-- Status colors column (right) -->
                ${statusColorEntries.map(([status, color], index) => {
                    const yPos = startY + (index * centerLineHeight);
                    
                    // Check if this is Working or Todo status to show plaid pattern
                    const isWorkingOrTodo = status === 'Working' || status === 'Todo';
                    const fillValue = isWorkingOrTodo ? 
                        `url(#plaid${status}Zero)` : // Use the Zero publishing stage for the legend
                        color;
                    
                    return `
                        <g transform="translate(25, ${yPos})">
                            <!-- Color SWATCH first (left) -->
                            <rect 
                                x="-20" 
                                y="-13" 
                                width="25" 
                                height="25" 
                                fill="${fillValue}"
                            />
                            
                            <!-- Status label with left justification -->
                            <text 
                                x="10" 
                                y="0" 
                                dominant-baseline="middle" 
                                text-anchor="start"
                                class="center-key-text"
                            >${status.toUpperCase()} <tspan style="font-size: 14px; opacity: 0.7; baseline-shift: super;">${statusCounts[status] || 0}</tspan></text>
                        </g>
                    `;
                }).join('')}
            </g>
        `;

        // Add number squares after all other elements but before synopses
        svg += `<g class="number-squares">`;
        scenes.forEach((scene) => {
            const { number } = parseSceneTitle(scene.title || '');
            if (number) {
                const subplot = scene.subplot || "Main Plot";
                const subplotIndex = masterSubplotOrder.indexOf(subplot);
                const ring = NUM_RINGS - 1 - subplotIndex;
                
                // Get the scenes for this act and subplot to determine correct index
                const sceneActNumber = scene.actNumber !== undefined ? scene.actNumber : 1;
                const actIndex = sceneActNumber - 1;
                const scenesInActAndSubplot = (scenesByActAndSubplot[actIndex] && scenesByActAndSubplot[actIndex][subplot]) || [];
                const sceneIndex = scenesInActAndSubplot.indexOf(scene);
                
                const startAngle = (actIndex * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
                const endAngle = ((actIndex + 1) * 2 * Math.PI) / NUM_ACTS - Math.PI / 2;
                const sceneAngleSize = (endAngle - startAngle) / scenesInActAndSubplot.length;
                const sceneStartAngle = startAngle + (sceneIndex * sceneAngleSize);
                
                const textPathRadius = (ringStartRadii[ring] + (ringStartRadii[ring] + ringWidths[ring])) / 2;
                
                // Reuse the existing square size calculation
                const getSquareSize = (num: string): { width: number, height: number } => {
                    const height = 18;
                    if (num.includes('.')) {
                        return {
                            width: num.length <= 3 ? 24 :
                                    num.length <= 4 ? 32 :
                                    36,
                            height: height
                        };
                    } else {
                        return {
                            width: num.length === 1 ? 20 :
                                    num.length === 2 ? 24 :
                                    28,
                            height: height
                        };
                    }
                };

                const squareSize = getSquareSize(number);
                const squareX = textPathRadius * Math.cos(sceneStartAngle) + 2;
                const squareY = textPathRadius * Math.sin(sceneStartAngle) + 2;
          
                // Store scene number information for square and synopsis
                const sceneId = `scene-path-${actIndex}-${ring}-${sceneIndex}`;
                sceneNumbersMap.set(sceneId, {
                    number,
                    x: squareX,
                    y: squareY,
                    width: squareSize.width,
                    height: squareSize.height
                });

                // Determine colors based on Edits metadata
                const hasEdits = scene.Edits && scene.Edits.trim() !== '';
                const squareBackgroundColor = hasEdits ? "#8875ff" : "white";
                const textColor = hasEdits ? "white" : "black";

                svg += `
                    <g transform="translate(${squareX}, ${squareY})">
                        <rect 
                            x="-${squareSize.width/2}" 
                            y="-${squareSize.height/2}" 
                            width="${squareSize.width}" 
                            height="${squareSize.height}" 
                            fill="${squareBackgroundColor}" 
                            class="number-square"
                            data-scene-id="${sceneId}"
                        />
                        <text 
                            x="0" 
                            y="0" 
                            text-anchor="middle" 
                            dominant-baseline="middle" 
                            class="number-text"
                            data-scene-id="${sceneId}"
                            dy="0.1em"
                            fill="${textColor}"
                        >${number}</text>
                    </g>
                `;
            }
        });
        svg += `</g>`;
        
        // Add all synopses at the end of the SVG
        svg += `            <g class="synopses-container">
                ${synopsesHTML.join('\n')}
            </g>
        `;

        // Add JavaScript to handle synopsis visibility
        const scriptSection = `
        <script>
            document.querySelectorAll('.scene-group').forEach(sceneGroup => {
                const scenePath = sceneGroup.querySelector('.scene-path');
                const sceneId = scenePath.id;
                const synopsis = document.querySelector(\`.scene-info[data-for-scene="\${sceneId}"]\`);
                
                sceneGroup.addEventListener('mouseenter', () => {
                    if (synopsis) {
                        synopsis.style.opacity = '1';
                        synopsis.style.pointerEvents = 'all';
                    }
                });
                
                sceneGroup.addEventListener('mouseleave', () => {
                    if (synopsis) {
                        synopsis.style.opacity = '0';
                        synopsis.style.pointerEvents = 'none';
                    }
                });
            });
        </script>`;

        svg += `
            ${scriptSection}
        </svg>`;
        return svg;
    }
    private darkenColor(color: string, percent: number): string {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max((num >> 16) - amt, 0);
        const G = Math.max(((num >> 8) & 0x00FF) - amt, 0);
        const B = Math.max((num & 0x0000FF) - amt, 0);
        return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
    }

    private lightenColor(color: string, percent: number): string {
        // Parse the color
        const num = parseInt(color.replace("#", ""), 16);
        
        // Extract original RGB values
        const R = (num >> 16);
        const G = ((num >> 8) & 0x00FF);
        const B = (num & 0x0000FF);
        
        // Calculate lightened values
        const mixRatio = Math.min(1, percent / 100); // How much white to mix in
        
        // Simple lightening calculation that preserves the hue
        const newR = Math.min(255, Math.round(R + (255 - R) * mixRatio));
        const newG = Math.min(255, Math.round(G + (255 - G) * mixRatio));
        const newB = Math.min(255, Math.round(B + (255 - B) * mixRatio));
        
        return "#" + (1 << 24 | newR << 16 | newG << 8 | newB).toString(16).slice(1);
    }

    /// Helper function to split text into balanced lines
    private splitIntoBalancedLines(text: string, maxWidth: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine: string[] = [];
        let currentLength = 0;
        const targetCharsPerLine = 60; // Approximately 60 characters per line for 500px width

        for (let word of words) {
            // Add 1 for the space after the word
            const wordLength = word.length + 1;
            
            if (currentLength + wordLength > targetCharsPerLine) {
                if (currentLine.length > 0) {
                    lines.push(currentLine.join(' '));
                    currentLine = [word];
                    currentLength = wordLength;
                } else {
                    // If a single word is longer than the line length, force it onto its own line
                    currentLine.push(word);
                    lines.push(currentLine.join(' '));
                    currentLine = [];
                    currentLength = 0;
                }
            } else {
                currentLine.push(word);
                currentLength += wordLength;
            }
        }

        if (currentLine.length > 0) {
            lines.push(currentLine.join(' '));
        }

        return lines;
    }

    // Add a helper method for hyphenation
    private hyphenateWord(word: string, maxWidth: number, charWidth: number): [string, string] {
        const maxChars = Math.floor(maxWidth / charWidth);
        if (word.length <= maxChars) return [word, ''];
        
        // Simple hyphenation at maxChars-1 to account for hyphen
        const firstPart = word.slice(0, maxChars - 1) + '-';
        const secondPart = word.slice(maxChars - 1);
        return [firstPart, secondPart];
    }

    private formatSynopsis(text: string, innerRadius: number, fontSize: number): string {
        const maxTextWidth = innerRadius * 2; // Maximum width of text block (fits within the inner void)
        const maxWordsPerLine = 7; // Adjust this for line balancing (approx. number of words per line)
    
        // Split text into lines with balanced word count
        const lines = this.splitIntoBalancedLines(text, maxWordsPerLine);
    
        // Calculate character width dynamically based on font size
        const characterWidth = 0.6 * fontSize; // Average character width multiplier
    
        // Prepare the formatted text to render inside the SVG
        return lines.map((line, i) => {
            const spaceCount = line.split(' ').length - 1;
            const lineWidth = line.length * characterWidth;
            const extraSpace = maxTextWidth - lineWidth;
    
            // Justify the text only if there's extra space and lines are more than one
            if (lineWidth < maxTextWidth && lines.length > 1 && spaceCount > 0 && extraSpace > 0) {
                const spacesNeeded = extraSpace / spaceCount;
                line = line.split(' ').join(' '.repeat(Math.ceil(spacesNeeded)));
                if (spacesNeeded < 0) {
                    this.log(`Negative spacesNeeded for line: "${line}"`);
                }
            }
    
            return `<text class="synopsis-text" x="0" y="${20 + i * 25}" text-anchor="middle">${line}</text>`;
        }).join(' ');
    
    }


    private formatSubplot(subplots: string): string {
        // Split the subplots into separate lines if there are multiple subplots
        const subplotsList = subplots.split(',').map(subplot => subplot.trim());
        return subplotsList.map((subplot, i) => {
            return `<text class="subplot-text" x="0" y="${-20 + i * 25}" text-anchor="middle">${subplot}</text>`;
        }).join(' ');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Add this helper function at the class level
    private parseSceneTitle(title: string): { number: string; cleanTitle: string } {
        // Split on first space
        const parts = title.trim().split(/\s+(.+)/);
        
        // Check if first part is a valid number
        if (parts.length > 1 && !isNaN(parseFloat(parts[0]))) {
            return {
                number: parts[0],
                cleanTitle: parts[1]
            };
        }
        return {
            number: "",
            cleanTitle: title.trim()
        };
    }

    private log(message: string, data?: any) {
        if (this.settings.debug) {
            if (data) {
                console.log(`Manuscript Timeline Plugin: ${message}`, data);
            } else {
                console.log(`Manuscript Timeline Plugin: ${message}`);
            }
        }
    }

    // Method to refresh the timeline if the active view exists
    refreshTimelineIfNeeded(file: TAbstractFile) {
        // Only refresh if the file is a markdown file
        if (!(file instanceof TFile) || file.extension !== 'md') {
            return;
        }

        // Get all timeline views
        const timelineViews = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)
            .map(leaf => leaf.view as ManuscriptTimelineView)
            .filter(view => view instanceof ManuscriptTimelineView);

        // Refresh each view
        for (const view of timelineViews) {
            if (view) {
                // Get the leaf that contains the view
                const leaf = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)[0];
                if (leaf) {
                    view.refreshTimeline();
                }
            }
        }
    }
}

class ManuscriptTimelineSettingTab extends PluginSettingTab {
    plugin: ManuscriptTimelinePlugin;

    constructor(app: App, plugin: ManuscriptTimelinePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'Manuscript Timeline Settings'});

        new Setting(containerEl)
            .setName('Source path')
            .setDesc('Path to your manuscript files')
            .addText(text => text
                .setPlaceholder('Enter path')
                .setValue(this.plugin.settings.sourcePath)
                .onChange(async (value) => {
                    this.plugin.settings.sourcePath = value;
                    await this.plugin.saveSettings();
                }));
                
        new Setting(containerEl)
            .setName('Debug mode')
            .setDesc('Enable debug logging in console')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debug)
                .onChange(async (value) => {
                    this.plugin.settings.debug = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', {text: 'Publishing Stage Colors'});
        
        // Add Reset to Default Colors button
        new Setting(containerEl)
            .setName('Reset to Default Colors')
            .setDesc('Restore all color settings to their default values')
            .addButton(button => button
                .setButtonText('Reset Colors')
                .onClick(async () => {
                    // Apply default colors from DEFAULT_SETTINGS constant
                    this.plugin.settings.publishStageColors = Object.assign({}, DEFAULT_SETTINGS.publishStageColors);
                    
                    // Save settings
                    await this.plugin.saveSettings();
                    
                    // Refresh the settings display to show updated colors
                    this.display();
                    
                    // Show a notice to confirm
                    new Notice('Publishing stage colors have been reset to defaults');
                }));
        
        // Create a color swatch function
        const createColorSwatch = (container: HTMLElement, color: string): HTMLElement => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = color;
            swatch.style.width = '20px';
            swatch.style.height = '20px';
            swatch.style.borderRadius = '3px';
            swatch.style.display = 'inline-block';
            swatch.style.marginRight = '8px';
            swatch.style.border = '1px solid var(--background-modifier-border)';
            
            container.appendChild(swatch);
            return swatch;
        };
        
        new Setting(containerEl)
            .setName('Zero Stage')
            .setDesc('Color for scenes in the Zero draft stage')
            .addText(text => {
                const colorInput = text
                    .setValue(this.plugin.settings.publishStageColors.Zero)
                    .onChange(async (value) => {
                        this.plugin.settings.publishStageColors.Zero = value;
                        await this.plugin.saveSettings();
                        if (swatch) {
                            swatch.style.backgroundColor = value;
                        }
                    });
                
                // Add null check before passing parent to the function
                const parent = text.inputEl.parentElement;
                const swatch = parent ? createColorSwatch(parent, this.plugin.settings.publishStageColors.Zero) : null;
                return colorInput;
            });

        new Setting(containerEl)
            .setName('Author Stage')
            .setDesc('Color for scenes in the Author stage')
            .addText(text => {
                const colorInput = text
                    .setValue(this.plugin.settings.publishStageColors.Author)
                    .onChange(async (value) => {
                        this.plugin.settings.publishStageColors.Author = value;
                        await this.plugin.saveSettings();
                        if (swatch) {
                            swatch.style.backgroundColor = value;
                        }
                    });
                
                // Add null check before passing parent to the function
                const parent = text.inputEl.parentElement;
                const swatch = parent ? createColorSwatch(parent, this.plugin.settings.publishStageColors.Author) : null;
                return colorInput;
            });

        new Setting(containerEl)
            .setName('House Stage')
            .setDesc('Color for scenes in the House stage')
            .addText(text => {
                const colorInput = text
                    .setValue(this.plugin.settings.publishStageColors.House)
                    .onChange(async (value) => {
                        this.plugin.settings.publishStageColors.House = value;
                        await this.plugin.saveSettings();
                        if (swatch) {
                            swatch.style.backgroundColor = value;
                        }
                    });
                
                // Add null check before passing parent to the function
                const parent = text.inputEl.parentElement;
                const swatch = parent ? createColorSwatch(parent, this.plugin.settings.publishStageColors.House) : null;
                return colorInput;
            });

        new Setting(containerEl)
            .setName('Press Stage')
            .setDesc('Color for scenes in the Press stage')
            .addText(text => {
                const colorInput = text
                    .setValue(this.plugin.settings.publishStageColors.Press)
                    .onChange(async (value) => {
                        this.plugin.settings.publishStageColors.Press = value;
                        await this.plugin.saveSettings();
                        if (swatch) {
                            swatch.style.backgroundColor = value;
                        }
                    });
                
                // Add null check before passing parent to the function
                const parent = text.inputEl.parentElement;
                const swatch = parent ? createColorSwatch(parent, this.plugin.settings.publishStageColors.Press) : null;
                return colorInput;
            });
            
        // Add horizontal rule to separate settings from documentation
        containerEl.createEl('hr', { cls: 'settings-separator' });
        
        // Add documentation section
        containerEl.createEl('h2', {text: 'Documentation', cls: 'setting-item-heading'});
        
        // Add horizontal rule to separate settings from documentation
        containerEl.createEl('hr', { cls: 'settings-separator' });
        
        // Add some basic styling for the documentation section
        const style = document.createElement('style');
        style.textContent = `
            .settings-separator {
                margin: 1em 0 2em 0;
                border: none;
                border-top: 1px solid var(--background-modifier-border);
            }
            .documentation-container {
                padding: 0 1em;
            }
            .documentation-container h1 {
                font-size: 1.8em;
                margin-top: 0.5em;
            }
            .documentation-container h2 {
                font-size: 1.5em;
                margin-top: 1.5em;
                padding-bottom: 0.3em;
                border-bottom: 1px solid var(--background-modifier-border);
            }
            .documentation-container h3 {
                font-size: 1.2em;
                margin-top: 1em;
            }
            .documentation-container img {
                max-width: 100%;
                border-radius: 5px;
                margin: 1em 0;
            }
            .documentation-container code {
                background-color: var(--background-primary);
                padding: 0.2em 0.4em;
                border-radius: 3px;
            }
            .documentation-container pre {
                background-color: var(--background-primary);
                padding: 1em;
                border-radius: 5px;
                overflow-x: auto;
                margin: 1em 0;
            }
            .metadata-example {
                line-height: 2em;
                white-space: pre;
                font-family: monospace;
                user-select: all;
                cursor: text;
            }
        `;
        document.head.appendChild(style);
        
        // Create a container for the documentation content
        const docContent = containerEl.createEl('div', {cls: 'documentation-container'});
        
        // Add README content - structured as Markdown but rendered as HTML
        docContent.innerHTML = `
            <h1>Obsidian Manuscript Timeline</h1>
            
            <p>A manuscript timeline for creative fiction writing projects that displays scenes organized by act, subplot, and chronological order in a radial format for a comprehensive view of project.</p>
            
            <h2>Features</h2>
            
            <ul>
                <li>Creates an interactive radial timeline visualization of your scenes</li>
                <li>Organizes scenes by act, subplot, and chronological order</li>
                <li>Shows scene details on hover including title, date, synopsis, subplots, and characters</li>
                <li>Color-codes scenes by status (Complete, Working, Todo, etc.)</li>
                <li>Supports both light and dark themes</li>
                <li>Allows clicking on scenes to open the corresponding file</li>
                <li>Fully integrated into Obsidian's interface - no external plugins required</li>
            </ul>
            
            <h2>Support Development</h2>
            
            <p>If you find this plugin useful, consider supporting its continued development:</p>
            
            <p><a href="https://www.buymeacoffee.com/ericrhystaylor" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;"></a></p>
            
            <h2>Display Requirements</h2>
            
            <p>This plugin creates an information-dense visualization that is more legible on high-resolution displays:</p>
            <ul>
                <li>Recommended: High-resolution displays such as Apple Retina displays or Windows equivalent (4K or better)</li>
                <li>The timeline contains detailed text and visual elements that benefit from higher pixel density</li>
                <li>While usable on standard displays, you may need to zoom in to see all details clearly</li>
            </ul>
            
            <h2>How to Use</h2>
            
            <ol>
                <li>Install the plugin in your Obsidian vault</li>
                <li>Configure the source path in the plugin settings to point to your scenes folder</li>
                <li>Ensure your scene files have the required frontmatter metadata (see below)</li>
                <li>Click the manuscript timeline ribbon icon or run the "Show Manuscript Timeline" command from the Command Palette</li>
                <li>The timeline will open in a new tab in the main editor area</li>
                <li>Interact with the timeline by hovering over scenes to see details and clicking to open the corresponding file</li>
                <li>The timeline automatically updates when you modify, create, or delete scene files</li>
            </ol>
            
            <h2>Settings</h2>
            
            <p>The plugin offers several settings to customize its behavior:</p>
            
            <ul>
                <li><strong>Source Path</strong>: Set the folder containing your scene files (e.g., "Book 1" or "Scenes")</li>
                <li><strong>Publishing Stage Colors</strong>: Customize colors for different publishing stages (Zero, Author, House, Press)</li>
                <li><strong>Reset to Default Colors</strong>: Restore all color settings to their original values if you've made changes</li>
                <li><strong>Debug Mode</strong>: Enable detailed logging in the console (useful for troubleshooting)</li>
            </ul>
            
            <h2>Required Scene Metadata</h2>
            
            <p>Scene files must have the following frontmatter:</p>
            <ul>
                <li>Class: Scene - Identifies the file as a scene</li>
                <li>When - Date of the scene (required)</li>
                <li>Title - Scene title</li>
                <li>Subplot - Subplot(s) the scene belongs to</li>
                <li>Act - Act number (1-3)</li>
                <li>Status - Scene status (Complete, Working, Todo, etc.)</li>
                <li>Synopsis - Brief description of the scene</li>
                <li>Character - Characters in the scene</li>
                <li>Due - Optional due date for the scene</li>
                <li>Edits - Optional editing notes (scenes with Edits will display with purple number boxes)</li>
                <li>Publish Stage - Publishing stage (Zero, Author, House, Press)</li>
            </ul>
            
            <h3>Example Metadata</h3>
            <p><em>Use "Paste and Match Style" when copying to avoid formatting issues</em></p>
            
            <pre class="metadata-example"><code>---
Class: Scene
Synopsis: The protagonist discovers a mysterious artifact.
Subplot:
  - The Great War
  - Jinnis Pickle
Act: 1
When: 2023-05-15
Character:
  - John Mars
  - Celon Tim
Place:
  - Diego
  - Earth
Publish Stage: Zero
Status: Complete
Edits:
---</code></pre>
            
            <h2>Timeline Visualization Elements</h2>
            
            <p>The timeline displays:</p>
            <ul>
                <li>Scenes arranged in a circular pattern</li>
                <li>Acts divided into sections</li>
                <li>Subplots organized in concentric rings</li>
                <li>Scene numbers in small boxes</li>
                <li>Color-coded scenes based on status</li>
                <li>Month markers around the perimeter</li>
                <li>Progress ring showing year progress</li>
            </ul>
            
            <p>Hover over a scene to see its details and click to open the corresponding file.</p>
            
            <p><a href="https://raw.githubusercontent.com/ericrhystaylor/obsidian-manuscript-timeline/master/screenshot.png" target="_blank" rel="noopener" style="display: inline-block; cursor: pointer;">
              <img src="https://raw.githubusercontent.com/ericrhystaylor/obsidian-manuscript-timeline/master/screenshot.png" alt="Example Timeline Screenshot" style="max-width: 100%; border-radius: 8px; border: 1px solid #444;">
            </a></p>
            <div style="text-align: center; font-size: 0.8em; margin-top: 5px; color: #888;">
              Click image to view full size in browser
            </div>
            
            <h2>Scene Ordering and Numbering</h2>
            
            <ul>
                <li>Scenes are ordered chronologically based on the When date in the frontmatter metadata</li>
                <li>The plugin parses scene numbers from the Title prefix (e.g., "1.2" in "1.2 The Discovery")</li>
                <li>These numbers are displayed in small boxes on the timeline</li>
                <li>Using numbered prefixes in your scene titles helps Obsidian order scenes correctly in the file explorer</li>
                <li>If scenes have the same When date, they are sub-ordered by their scene number</li>
            </ul>
            
            <h2>Technical Implementation</h2>
            
            <p>The Manuscript Timeline visualization was inspired by and draws on principles from <a href="https://d3js.org">D3.js</a>, a powerful JavaScript library for producing dynamic, interactive data visualizations. While the plugin doesn't directly use the D3 library to reduce dependencies, it implements several D3-style approaches:</p>
            
            <ul>
                <li>SVG-based visualization techniques</li>
                <li>Data-driven document manipulation</li>
                <li>Interactive elements with hover and click behaviors</li>
                <li>Radial layouts and polar coordinates</li>
                <li>Scale transformations and data mapping</li>
                <li>Dynamic color manipulation and pattern generation</li>
            </ul>
            
            <p>The visualizations are built using pure SVG and JavaScript, offering a lightweight solution that maintains the elegance and interactivity of D3-style visualizations while being fully compatible with Obsidian's rendering capabilities.</p>
            
            <h2>Installation</h2>
            
            <ul>
                <li>Download the latest release</li>
                <li>Extract the files to your vault's <code>.obsidian/plugins/manuscript-timeline</code> folder</li>
                <li>Enable the plugin in Obsidian's Community Plugins settings</li>
            </ul>
            
            <h2>Development</h2>
            
            <p>Development of this plugin is private. The source code is provided for transparency and to allow users to verify its functionality, but it is not licensed for derivative works.</p>
            
            <p>If you wish to contribute to the development of this plugin or report issues:</p>
            <ul>
                <li><a href="https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline/issues">Open an issue on GitHub</a> to report bugs or suggest features</li>
                <li>Contact the author via GitHub for potential collaboration opportunities</li>
            </ul>
            
            <p>Any modifications or derivative works require explicit permission from the author.</p>
            
            <h2>License</h2>
            
            <p>© 2025 Eric Rhys Taylor. All Rights Reserved.</p>
            
            <p>This Obsidian plugin is proprietary software.</p>
            <ul>
                <li>You may use this plugin for personal use only.</li>
                <li>You may not copy, modify, distribute, sublicense, or resell any part of this plugin.</li>
                <li>Commercial use of this software (e.g., as part of a paid product or service) is strictly prohibited without a separate license agreement.</li>
                <li>Attribution is required in any mention or reference to this plugin.</li>
            </ul>
            
            <p>For licensing inquiries, please contact via GitHub.</p>
            
            <h2>Author</h2>
            
            <p>Created by Eric Rhys Taylor</p>
            
            <h2>Questions & Support</h2>
            
            <p>For questions, issues, or feature requests, please <a href="https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline/issues">open an issue on GitHub</a>.</p>
        `;
    }
}

// Timeline View implementation
export class ManuscriptTimelineView extends ItemView {
    plugin: ManuscriptTimelinePlugin;
    sceneData: Scene[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: ManuscriptTimelinePlugin) {
        super(leaf);
        this.plugin = plugin;
    }
    
    getViewType(): string {
        return TIMELINE_VIEW_TYPE;
    }
    
    getDisplayText(): string {
        return TIMELINE_VIEW_DISPLAY_TEXT;
    }
    
    async onOpen(): Promise<void> {
        this.refreshTimeline();
    }

    refreshTimeline() {
        const container = this.contentEl;
        container.empty();
        
        const loadingEl = container.createEl("div", {
            cls: "loading-message",
            text: "Loading timeline data..."
        });
        
        // Get the scene data using the plugin's method
        this.plugin.getSceneData()
            .then(sceneData => {
                this.sceneData = sceneData;
                
                // Remove the loading message
                loadingEl.remove();
                
                // Render the timeline with the scene data
                this.renderTimeline(container, this.sceneData);
            })
            .catch(error => {
                loadingEl.textContent = `Error: ${error.message}`;
                if (this.plugin.settings.debug) {
                    console.error("Failed to load timeline data", error);
                }
            });
    }
    
    async onClose(): Promise<void> {
        // Clean up any event listeners or resources
    }
    
    renderTimeline(container: HTMLElement, scenes: Scene[]): void {
        // Clear container first
        container.empty();
        container.addClass('manuscript-timeline-container');
        
        if (!scenes || scenes.length === 0) {
            container.createEl('p', { text: 'No scene data available.' });
            return;
        }
        
        // Add a local lightenColor function to avoid using the private plugin method
        const lightenColorLocally = (color: string, percent: number): string => {
            // Remove the # if present
            let hex = color.replace('#', '');
            
            // Convert to RGB
            let r = parseInt(hex.slice(0, 2), 16);
            let g = parseInt(hex.slice(2, 4), 16);
            let b = parseInt(hex.slice(4, 6), 16);
            
            // Lighten by the percentage
            r = Math.min(255, r + Math.floor((255 - r) * (percent / 100)));
            g = Math.min(255, g + Math.floor((255 - g) * (percent / 100)));
            b = Math.min(255, b + Math.floor((255 - b) * (percent / 100)));
            
            // Convert back to hex
            return '#' + r.toString(16).padStart(2, '0') + 
                         g.toString(16).padStart(2, '0') + 
                         b.toString(16).padStart(2, '0');
        };
        
        // Instead of recreating the SVG from scratch, use the existing method
        try {
            // Generate the SVG content using the plugin's existing method
            const svgContent = this.plugin.createTimelineSVG(scenes);
            
            // Create a container with proper styling for centered content
            const timelineContainer = container.createEl("div", {
                cls: "manuscript-timeline-container",
                attr: {
                    style: "display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; overflow: auto;"
                }
            });
            
            // Set the SVG content
            timelineContainer.innerHTML = svgContent;
            
            // Find the SVG element
            const svgElement = timelineContainer.querySelector("svg");
            if (svgElement) {
                // Center the SVG
                svgElement.style.width = "100%";
                svgElement.style.height = "100%";
                svgElement.style.maxHeight = "calc(100vh - 100px)";
                svgElement.style.maxWidth = "100%";
                svgElement.style.margin = "0 auto";
                svgElement.style.transformOrigin = "center";
                svgElement.style.cursor = "default";
                
                // Manually add mouseover event handlers for scene groups
                const sceneGroups = timelineContainer.querySelectorAll(".scene-group");
                sceneGroups.forEach(sceneGroup => {
                    // Get the scene path element ID
                    const scenePath = sceneGroup.querySelector(".scene-path");
                    if (!scenePath) return;
                    
                    const sceneId = scenePath.id;
                    const synopsisEl = timelineContainer.querySelector(`.scene-info[data-for-scene="${sceneId}"]`);
                    
                    // Add mouseenter event to show synopsis
                    sceneGroup.addEventListener("mouseenter", (e) => {
                        // Show the synopsis
                        if (synopsisEl) {
                            synopsisEl.setAttribute("style", "opacity: 1; pointer-events: all;");
                        }
                        
                        // Fade all other scenes including void scenes
                        timelineContainer.querySelectorAll("path.scene-path").forEach(pathEl => {
                            if (pathEl.id !== sceneId) {
                                // Store original fill if not already stored
                                if (!pathEl.hasAttribute("data-original-fill")) {
                                    const currentFill = pathEl.getAttribute("fill");
                                    pathEl.setAttribute("data-original-fill", currentFill || "");
                                }
                                
                                // Get original fill to calculate lighter version
                                const originalFill = pathEl.getAttribute("data-original-fill") || "";
                                
                                // Apply lighter color instead of just reducing opacity
                                if (originalFill.startsWith("#")) {
                                    // For hex colors, apply a lighter version
                                    try {
                                        // Simple lightening algorithm
                                        const lighterColor = lightenColorLocally(originalFill, 70);
                                        pathEl.setAttribute("fill", lighterColor);
                                    } catch (e) {
                                        // Fallback to opacity if color lightening fails
                                        pathEl.classList.add("faded");
                                    }
                                } else if (originalFill.startsWith("url(#")) {
                                    // For pattern fills (like plaid for Todo/Working), add semi-transparent overlay to lighten
                                    // Instead of just reducing opacity which makes it darker
                                    
                                    // First check if we've already added a lighter class to avoid duplicating
                                    if (!pathEl.classList.contains("plaid-lighter")) {
                                        // Add a class to identify this element as having a plaid filter
                                        pathEl.classList.add("plaid-lighter");
                                        
                                        // Create an overlay filter if it doesn't exist yet
                                        if (!document.getElementById('lighten-plaid-filter')) {
                                            const svg = timelineContainer.querySelector('svg');
                                            if (svg) {
                                                // Create a filter that preserves colors while making them lighter
                                                const defs = svg.querySelector('defs') || svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "defs"));
                                                const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
                                                filter.setAttribute("id", "lighten-plaid-filter");
                                                
                                                // Instead of a color matrix, use a component transfer to adjust brightness
                                                // This preserves the hue while making colors lighter
                                                const feComponentTransfer = document.createElementNS("http://www.w3.org/2000/svg", "feComponentTransfer");
                                                
                                                // Create function for each color channel
                                                const funcR = document.createElementNS("http://www.w3.org/2000/svg", "feFuncR");
                                                funcR.setAttribute("type", "linear");
                                                funcR.setAttribute("slope", "0.5");
                                                funcR.setAttribute("intercept", "0.5");
                                                
                                                const funcG = document.createElementNS("http://www.w3.org/2000/svg", "feFuncG");
                                                funcG.setAttribute("type", "linear");
                                                funcG.setAttribute("slope", "0.5");
                                                funcG.setAttribute("intercept", "0.5");
                                                
                                                const funcB = document.createElementNS("http://www.w3.org/2000/svg", "feFuncB");
                                                funcB.setAttribute("type", "linear");
                                                funcB.setAttribute("slope", "0.5");
                                                funcB.setAttribute("intercept", "0.5");
                                                
                                                // Add the functions to the component transfer
                                                feComponentTransfer.appendChild(funcR);
                                                feComponentTransfer.appendChild(funcG);
                                                feComponentTransfer.appendChild(funcB);
                                                
                                                filter.appendChild(feComponentTransfer);
                                                defs.appendChild(filter);
                                            }
                                        }
                                        
                                        // Apply the lighten filter
                                        pathEl.setAttribute("filter", "url(#lighten-plaid-filter)");
                                    }
                                } else {
                                    // For any other fill, use opacity
                                    pathEl.classList.add("faded");
                                }
                            }
                        });
                        
                        // Also fade void arcs which aren't part of scene-path class
                        timelineContainer.querySelectorAll("path:not(.scene-path)").forEach(pathEl => {
                            // Skip any paths that are part of other elements like month lines
                            if (pathEl.parentElement && 
                                !pathEl.parentElement.classList.contains("month-spokes") &&
                                !pathEl.parentElement.classList.contains("act-borders") &&
                                !pathEl.id.startsWith("monthLabelPath-") &&
                                !pathEl.id.startsWith("innerMonthPath-") &&
                                !pathEl.id.startsWith("actPath-") &&
                                !pathEl.classList.contains("progress-ring-base") &&
                                !pathEl.classList.contains("progress-ring-fill")) {
                                
                                // Store original fill if not already stored
                                if (!pathEl.hasAttribute("data-original-fill")) {
                                    const currentFill = pathEl.getAttribute("fill");
                                    pathEl.setAttribute("data-original-fill", currentFill || "");
                                }
                                
                                // Get original fill
                                const originalFill = pathEl.getAttribute("data-original-fill") || "";
                                
                                // Apply lighter color to void arcs too
                                if (originalFill.startsWith("#")) {
                                    try {
                                        const lighterColor = lightenColorLocally(originalFill, 70);
                                        pathEl.setAttribute("fill", lighterColor);
                                    } catch (e) {
                                        pathEl.classList.add("faded");
                                    }
                                } else {
                                    pathEl.classList.add("faded");
                                }
                            }
                        });
                        
                        // Fade the title text
                        sceneGroups.forEach(otherGroup => {
                            if (otherGroup !== sceneGroup) {
                                const titleEl = otherGroup.querySelector(".scene-title");
                                if (titleEl) {
                                    titleEl.classList.add("faded");
                                }
                            }
                        });
                        
                        // Fade all number squares except for the current scene
                        timelineContainer.querySelectorAll(".number-square, .number-text").forEach(el => {
                            const dataSceneId = el.getAttribute("data-scene-id");
                            if (dataSceneId !== sceneId) {
                                el.classList.add("faded");
                            }
                        });
                    });
                    
                    // Add mouseleave event to hide synopsis and restore colors
                    sceneGroup.addEventListener("mouseleave", (e) => {
                        // Hide the synopsis
                        if (synopsisEl) {
                            synopsisEl.setAttribute("style", "opacity: 0; pointer-events: none;");
                        }
                        
                        // Restore original colors for scene paths
                        timelineContainer.querySelectorAll("path.scene-path").forEach(pathEl => {
                            const originalFill = pathEl.getAttribute("data-original-fill");
                            if (originalFill) {
                                pathEl.setAttribute("fill", originalFill);
                                pathEl.removeAttribute("data-original-fill");
                            }
                            // Remove any filters that were applied
                            if (pathEl.hasAttribute("filter")) {
                                pathEl.removeAttribute("filter");
                            }
                            pathEl.classList.remove("faded");
                            pathEl.classList.remove("plaid-lighter");
                        });
                        
                        // Restore original colors for void arcs
                        timelineContainer.querySelectorAll("path:not(.scene-path)").forEach(pathEl => {
                            const originalFill = pathEl.getAttribute("data-original-fill");
                            if (originalFill) {
                                pathEl.setAttribute("fill", originalFill);
                                pathEl.removeAttribute("data-original-fill");
                            }
                            pathEl.classList.remove("faded");
                        });
                        
                        // Restore title opacity
                        timelineContainer.querySelectorAll(".scene-title").forEach(titleEl => {
                            titleEl.classList.remove("faded");
                        });
                        
                        // Restore all number squares
                        timelineContainer.querySelectorAll(".number-square, .number-text").forEach(el => {
                            el.classList.remove("faded");
                        });
                    });
                });
                
                // Add click event for scene paths to open the file
                timelineContainer.querySelectorAll(".scene-path").forEach(element => {
                    element.addEventListener("click", (event) => {
                        const parentGroup = (element as HTMLElement).closest(".scene-group");
                        if (parentGroup) {
                            const path = parentGroup.getAttribute("data-path");
                            if (path) {
                                const file = this.app.vault.getAbstractFileByPath(decodeURIComponent(path));
                                if (file instanceof TFile) {
                                    this.app.workspace.getLeaf().openFile(file);
                                    event.stopPropagation();
                                }
                            }
                        }
                    });
                });
                
                // Add CSS for better visual effects
                const styleEl = document.createElement("style");
                styleEl.textContent = `
                    .scene-path.faded {
                        opacity: 0.3;
                        transition: opacity 0.2s ease-out;
                    }
                    
                    .scene-title.faded {
                        opacity: 0.2;
                    }
                    
                    .number-square.faded, .number-text.faded {
                        opacity: 0.2;
                    }
                `;
                document.head.appendChild(styleEl);
            }
            
        } catch (error) {
            if (this.plugin.settings.debug) {
                console.error("Error rendering timeline:", error);
            }
            container.createEl("div", {
                cls: "error-message",
                text: `Error rendering timeline: ${error.message}`
            });
        }
    }
}