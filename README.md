# Solidtime

Solidtime is a VSCode extension that tracks your coding time and sends periodic updates to the Solidtime API. Manage your API key, API URL, and organization ID directly from VSCode.

## Features

- Tracks time spent coding
- Automatically sends time updates when a file change is detected or after a set interval
- Pauses tracking after 2 minutes of inactivity
- Provides commands to set and update your API key, API URL, and organization ID
- Manual trigger for time updates

## Usage

1. Open the project in VSCode.
2. Use the command palette to execute any of the following commands:
   - **Solidtime: Set API Key**
   - **Solidtime: Set API URL**
   - **Solidtime: Set Organization ID**
   - **Solidtime: Force Time Update**

The extension automatically tracks activity and sends time updates in the background.

## Development

1. Install Bun ([https://bun.sh](https://bun.sh)).
2. Clone the repository.
3. Run `bun install` to install dependencies.
4. Build the extension with `bun run build`.

- Main code is located in `src/extension.ts`
- Uses ES6 modules and Bun for bundling
- To watch for changes and auto-build, run:  
  `bun run watch`
- Press `F5` to launch the extension in a new Extension Development Host window.
