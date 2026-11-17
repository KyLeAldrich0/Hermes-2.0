# FormSense - Stealth Google Form Quiz Solver

A lightweight Chrome Extension (Manifest V3) designed to parse and answer Google Form quizzes using the Google Gemini API. It runs silently with minimal UI, executing DOM scraping and simulated input events upon trigger.

---

## Disclaimer

This software is provided for educational and research purposes only. Use this tool entirely at your own risk. The developer and contributors assume no liability, accountability, or responsibility for any consequences, disciplinary measures, academic penalties, loss of access, or damages arising from the installation, use, or misuse of this project. Users are solely responsible for ensuring compliance with all applicable school policies, institutional terms, and exam regulations before running this software.

---

## Features

- **Decoupled Architecture (Manifest V3):** Uses background service workers for API communication to prevent CORS issues, maintaining local state via `chrome.storage.local`.
- **Minimalist Feedback:** Operates without permanent page modifications. A temporary status pill appears at the bottom-left during scanning and automatically dismisses upon completion.
- **Form Parsing Engine:** Identifies and extracts questions across standard and modern Google Forms schemas:
  - Multiple Choice (`role="radio"`)
  - Checkboxes (`role="checkbox"`)
  - Dropdown Selectors (`role="listbox"`)
  - Short Answer and Paragraph fields (`input[type="text"]`, `textarea`)
- **Framework-Compliant Event Dispatching:** Dispatches pointer, mouse, and input event sequences (`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`, `input`, `change`, `blur`) to ensure Google Forms' internal Closure/Wiz state synchronizes properly.
- **Dynamic Model Resolution:** Communicates with Google's ModelService to resolve available models for your specific API key, defaulting to high-throughput options such as `gemini-3.8-flash` or `gemini-3.5-flash-lite`.
- **Review Safe:** Fills in answers only. Does not trigger form submission.

---

## Project Structure

```
├── manifest.json       Extension manifest (MV3 permissions, commands, host scopes)
├── popup.html          Settings interface for API credentials and model configuration
├── popup.js            Credential persistence and active model loader
├── background.js       Background worker handling commands and API dispatch
├── content.js          DOM extraction, event simulation, and status indicator
└── README.md           Project documentation
```

---

## Installation

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the root folder of this project (`Hermes 2.0`).

---

## Configuration

1. Obtain an API key from Google AI Studio.
2. Click the extension icon in the Chrome toolbar to open the settings popup.
3. Paste your Gemini API key.
4. The extension will query available models for your key. Select your preferred model (e.g., `gemini-3.8-flash` or `gemini-3.5-flash-lite`).
5. Click **Save Settings**.

---

## Usage

1. Open any Google Form in view mode (`https://docs.google.com/forms/...`).
2. If the page was already open before loading or modifying the extension, refresh the tab once (`F5` or `Ctrl + R`).
3. Trigger the solver using either of the following methods:
   - **Keyboard Shortcut:** Press `Ctrl + Shift + Y` (Windows/Linux) or `Cmd + Shift + Y` (macOS).
   - **Popup Trigger:** Open the extension popup and click **Solve Active Google Form**.
4. The indicator at the bottom-left will display current progress (scanning, querying, filling) and will dismiss once completed.
5. Review the populated selections before manually submitting the form.
