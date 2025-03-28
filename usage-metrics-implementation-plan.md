# RooCode Usage Metrics Implementation Plan

## 1. Overview

This document outlines the plan to implement a usage metrics tracking feature for RooCode. The feature will provide insights into how users are using the tool, helping them understand their usage patterns, optimize costs, and track productivity gains.

## 2. Feature Requirements

- **Auto-enabled by default** with option to disable via a toggle in settings
- **Persistent storage** of metrics between sessions using VSCode global state
- **Privacy-focused** by keeping all data local to the user's machine
- **Visualizations** to help users interpret the data in the RooCode UI style
- **Minimal performance impact** on core functionality

## 3. Metrics to Capture

### Code Generation Metrics

- **Lines of Code Generated**: Track total lines written via write_to_file and apply_diff tools
- **Files Created/Modified**: Count of new files vs. modified files
- **Programming Languages**: Track usage across different file types/languages
- **Function/Class Count**: Approximate count of functions/classes generated

### Usage Metrics

- **Tasks Completed**: Total number of tasks
- **Commands Executed**: Count of CLI commands run
- **API Calls**: Number of API requests made
- **Browser Sessions**: Number of browser sessions launched
- **Active Usage Time**: Time spent actively using RooCode

### Cost Metrics

- **Total API Cost**: Accumulated cost across all requests (matching the $X.XXXX format shown in the UI)
- **Cost per Task**: Average and total cost per completed task
- **Token Efficiency**: Ratio of productive tokens to total tokens
- **Cost Breakdown by Provider**: Split by API provider (Anthropic, OpenAI, etc.)

### Tool Usage Metrics

- **Tool Distribution**: Percentage breakdown of tool usage
- **Most Used Tools**: Ranking of most frequently used tools
- **MCP Tool Usage**: Statistics for Model Context Protocol tools

## 4. Implementation Architecture

### 4.1 Data Storage

We'll implement storage for metrics data via VSCode's global state:

1. **Add to GlobalStateKey**:
    - Add `usageMetricsEnabled` (boolean)
    - Add `usageMetrics` (object to store all accumulated metrics)
2. **Metrics Data Structure**:

```typescript
interface UsageMetrics {
	// Code metrics
	linesOfCodeGenerated: number
	filesCreated: number
	filesModified: number
	languageUsage: Record<string, number> // e.g. {"javascript": 200, "python": 150}

	// Usage metrics
	tasksCompleted: number
	commandsExecuted: number
	apiCallsMade: number
	browserSessionsLaunched: number
	activeUsageTimeMs: number

	// Cost metrics
	totalApiCost: number
	costByProvider: Record<string, number>
	costByTask: Record<string, number>

	// Tool usage
	toolUsage: Record<string, number>

	// Last reset timestamp
	lastReset: number
}
```

### 4.2 Metrics Collection

Implement event tracking throughout the codebase:

1. **Code Generation Tracking**:

    - Intercept write_to_file and apply_diff operations
    - Count lines and detect language by file extension
    - Track new vs. modified files

2. **API Cost Tracking**:
    - Enhance existing cost tracking in API requests
    - Aggregate costs by model and provider
3. **Tool Usage Tracking**:
    - Add tracking code in tool execution handlers
    - Count frequency of each tool type
4. **Time Tracking**:
    - Implement session time tracking
    - Record active vs. idle time

## 5. Implementation Steps

### 5.1 Update Global State Types

1. Update `src/shared/globalState.ts`:
    - Add `usageMetricsEnabled` and `usageMetrics` to `GlobalStateKey`
2. Update `src/shared/ExtensionMessage.ts`:
    - Add `usageMetricsEnabled` to `ExtensionState` interface
    - Add `usageMetrics` to `ExtensionState` interface

### 5.2 Add Storage and UI Message Handlers

1. Update `src/core/webview/ClineProvider.ts`:

    - Add handler for `usageMetricsEnabled` toggle
    - Add updating logic for metrics collection
    - Add reset metrics functionality
    - Initialize metrics properly on first use

2. Update `src/shared/WebviewMessage.ts`:
    - Add `usageMetricsEnabled` to `WebviewMessage` type
    - Add `resetUsageMetrics` to `WebviewMessage` type

### 5.3 Implement Metrics Collection Logic

1. Create new file `src/utils/metrics.ts`:

    - Implement functions to track and update different metrics
    - Add helper functions for calculations and aggregations
    - Implement file type detection for language tracking

2. Modify existing code to call metrics functions:
    - Update in `ClineProvider.ts` for tool operations
    - Update API handler code to track costs
    - Implement hooks in command execution

### 5.4 Create UI Components for Metrics Display

1. Create a new component in `webview-ui/src/components/settings/UsageMetrics.tsx`:

    - Follow the existing design language of the Settings UI
    - Use the same dark theme and styling as other settings components
    - Implement sliders and toggles consistent with existing UI elements
    - Create sections with clear headings similar to "Provider Settings" and "Advanced Settings"

2. Update `webview-ui/src/components/settings/SettingsView.tsx`:
    - Add UsageMetrics component to settings view
    - Add toggle for enabling/disabling metrics collection that matches the existing toggle style
    - Position the metrics section logically within the settings hierarchy

## 6. User Interface Design

The metrics UI will be integrated into the Settings page with a new "Usage Metrics" section that follows the same design patterns as the existing UI:

1. **Toggle Section**:

    - Include a toggle with label "Enable usage metrics" similar to the auto-approve toggles
    - Add a descriptive text explaining the feature

2. **Metrics Overview**:

    - Display key metrics with clear labels and values
    - Use the same font styles and spacing as existing settings

3. **Detailed Metrics Sections**:

    - Organize metrics into collapsible sections
    - Use consistent headings and subheadings
    - Include numerical values with appropriate formatting

4. **Visual Elements**:

    - Add simple visualizations that match the dark theme
    - Use progress bars similar to the token sliders for percentage values
    - Ensure all elements respect the VSCode theming

5. **Controls**:
    - Include a "Reset Metrics" button styled like the "Reset State" button
    - Position controls consistently with other settings sections

## 7. UI Implementation Details

Based on the UI screenshots, the UsageMetrics component should:

1. **Match Styling**:

    - Use the same dark background and text colors
    - Match the font sizes and weights
    - Adopt the same spacing between elements

2. **Use Consistent Controls**:

    - Implement sliders that look identical to the existing token sliders
    - Use checkboxes that match the style of existing toggles
    - Follow the same button styling for actions

3. **Layout Structure**:

    - Maintain the vertical column layout
    - Group related metrics together
    - Use consistent padding and margins

4. **Information Display**:

    - Show numerical values with appropriate precision (matching the cost format $X.XXXX)
    - Include descriptive text under controls similar to existing settings

5. **Integration Point**:
    - Add the metrics section as a new section in the settings panel
    - Position it logically in the settings hierarchy (possibly after Advanced Settings)

## 8. Testing Strategy

1. **Unit Tests**:

    - Test metric calculation functions
    - Test data persistence
    - Test reset functionality

2. **Integration Tests**:

    - Test metrics collection during normal operation
    - Test UI display with various data scenarios

3. **UI Tests**:
    - Create test file `webview-ui/src/components/settings/__tests__/UsageMetrics.test.tsx`
    - Test rendering with different metrics data
    - Test toggle functionality
    - Test reset functionality

## 9. Future Enhancements

1. **Metrics Export**: Allow exporting metrics data as CSV/JSON
2. **Visualization Improvements**: Add more detailed charts/graphs
3. **Recommendations Engine**: Provide optimization suggestions based on metrics
4. **Team Analytics**: Aggregate metrics across team members
5. **Cost Forecasting**: Predict future costs based on usage patterns

## 10. Implementation Timeline

1. Global state and basic tracking: 2-3 days
2. UI Implementation: 2 days
3. Testing and refinement: 2 days
4. Documentation: 1 day

Total estimated time: 7-8 days
