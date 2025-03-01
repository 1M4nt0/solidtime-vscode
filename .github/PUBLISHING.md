# Publishing SolidTime VSCode Extension

This document explains how to publish the SolidTime extension to both the VS Code Marketplace and Open VSX Registry using GitHub Actions.

## Prerequisites

1. You need to set up two secrets in your GitHub repository:
   - `VSCE_PAT`: Personal Access Token for the VS Code Marketplace
   - `OVSX_PAT`: Access Token for the Open VSX Registry

## Setting Up Secrets

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add the following secrets:

### VSCE_PAT
1. Get a Personal Access Token from Azure DevOps:
   - Go to https://dev.azure.com/[your-organization]/_usersSettings/tokens
   - Create a new token with the "Marketplace (publish)" scope
   - Copy the generated token
2. Add it as a secret named `VSCE_PAT`

### OVSX_PAT
1. Get a token from Open VSX Registry:
   - Go to https://open-vsx.org/user-settings/tokens
   - Create a new token
   - Copy the generated token
2. Add it as a secret named `OVSX_PAT`

## Publishing Process

The extension is automatically published when you push a tag that starts with 'v' (e.g., v1.0.0).

### Manual Publishing Steps

1. Update the version in `package.json`
2. Commit your changes
3. Create and push a new tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

4. The GitHub Action will automatically:
   - Build the extension
   - Package it
   - Publish to VS Code Marketplace
   - Publish to Open VSX Registry
   - Create a GitHub Release with the .vsix file

## Troubleshooting

If the publishing fails, check the GitHub Actions log for details. Common issues include:

- Invalid or expired access tokens
- Version conflicts (trying to publish a version that already exists)
- Missing package.json fields required for publishing 