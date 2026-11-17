// FormSense - Content Script for Google Forms DOM Automation

(function () {
  // Prevent duplicate script registration
  if (window.__formsense_initialized) return;
  window.__formsense_initialized = true;

  // 1. Direct page keyboard listener for Ctrl+Shift+Y / Cmd+Shift+Y
  window.addEventListener("keydown", (e) => {
    const isY = e.key === "Y" || e.key === "y" || e.code === "KeyY";
    const hasModifier = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (hasModifier && isY) {
      e.preventDefault();
      executeQuizSolving();
    }
  });

  // 2. Extension message listener (from background script or popup)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TRIGGER_SOLVE") {
      executeQuizSolving();
      sendResponse({ status: "started" });
    }
  });

  /**
   * Main solving workflow
   */
  async function executeQuizSolving() {
    const indicator = createStatusIndicator();
    indicator.update("Scanning questions...", "loading");

    try {
      // 1. Scrape question elements from the form
      const questionsData = extractFormQuestions();

      if (!questionsData || questionsData.length === 0) {
        throw new Error("No questions found. Make sure this is a Google Form in view mode.");
      }

      indicator.update(`Found ${questionsData.length} question(s). Solving...`, "loading");

      // 2. Prepare payload for AI solver
      const payload = questionsData.map((q) => ({
        index: q.index,
        type: q.type,
        question: q.questionText,
        options: q.options.map((opt) => opt.text)
      }));

      // 3. Send payload to background script
      const response = await chrome.runtime.sendMessage({
        action: "SOLVE_FORM_QUESTIONS",
        questions: payload
      });

      if (!response || !response.success) {
        throw new Error(response?.error || "Failed to receive answers from AI API.");
      }

      // 4. Fill in answers
      indicator.update("Filling answers...", "loading");
      const filledCount = await applyAnswersToDOM(questionsData, response.answers);

      // 5. Success feedback
      indicator.update(`Filled ${filledCount}/${questionsData.length} questions ✓`, "success");
      setTimeout(() => indicator.remove(), 2500);
    } catch (err) {
      console.error("[FormSense]", err);
      indicator.update(`Error: ${err.message}`, "error");
      setTimeout(() => indicator.remove(), 4000);
    }
  }

  /**
   * Discreet Status Indicator (18px Spinner + Sleek Subtle Toast)
   */
  function createStatusIndicator() {
    // Clean up any existing indicator
    const existing = document.getElementById("formsense-indicator-container");
    if (existing) existing.remove();

    const styleId = "formsense-indicator-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        @keyframes formsense-rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        #formsense-indicator-container {
          position: fixed !important;
          bottom: 12px !important;
          left: 12px !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          background: rgba(15, 17, 23, 0.88) !important;
          backdrop-filter: blur(8px) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          border-radius: 20px !important;
          padding: 5px 12px 5px 8px !important;
          color: #e2e8f0 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-size: 11px !important;
          font-weight: 500 !important;
          z-index: 9999999 !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
          pointer-events: none !important;
          transition: opacity 0.3s ease, transform 0.3s ease !important;
        }
        .formsense-spinner {
          width: 14px !important;
          height: 14px !important;
          border-radius: 50% !important;
          border: 2px solid rgba(255, 255, 255, 0.2) !important;
          border-top-color: #00f2fe !important;
          animation: formsense-rotate 0.75s linear infinite !important;
          flex-shrink: 0 !important;
        }
        .formsense-spinner.error {
          border-color: rgba(255, 68, 68, 0.25) !important;
          border-top-color: #ff4444 !important;
          animation-duration: 0.35s !important;
        }
        .formsense-spinner.success {
          border-color: rgba(0, 230, 118, 0.25) !important;
          border-top-color: #00e676 !important;
          animation: none !important;
          border-width: 0 !important;
          background: #00e676 !important;
          width: 8px !important;
          height: 8px !important;
        }
      `;
      document.head.appendChild(style);
    }

    const container = document.createElement("div");
    container.id = "formsense-indicator-container";

    const spinner = document.createElement("div");
    spinner.className = "formsense-spinner";

    const label = document.createElement("span");
    label.textContent = "FormSense...";

    container.appendChild(spinner);
    container.appendChild(label);
    document.body.appendChild(container);

    return {
      update(text, state = "loading") {
        label.textContent = text;
        spinner.className = `formsense-spinner ${state}`;
      },
      remove() {
        container.style.opacity = "0";
        container.style.transform = "translateY(6px)";
        setTimeout(() => container.remove(), 350);
      }
    };
  }

  /**
   * Scrapes question blocks and their corresponding options
   */
  function extractFormQuestions() {
    // Google Forms uses several question card classes across different versions
    let items = Array.from(document.querySelectorAll('div[role="listitem"]'));

    if (items.length === 0) {
      items = Array.from(document.querySelectorAll('.Qr7Oae, .geS5n, div[data-item-id]'));
    }

    // Fallback: search headings and get parent card
    if (items.length === 0) {
      const headings = Array.from(document.querySelectorAll('div[role="heading"], .M7eMe'));
      const cardSet = new Set();
      headings.forEach((h) => {
        const card = h.closest('.Qr7Oae, .geS5n, div[jsmodel], div[data-params]');
        if (card) cardSet.add(card);
      });
      items = Array.from(cardSet);
    }

    const questions = [];

    items.forEach((item, index) => {
      // 1. Question Title/Prompt
      const headingEl = item.querySelector('div[role="heading"], .M7eMe, .HoXoMd');
      let questionText = headingEl ? headingEl.innerText.trim() : "";

      // Fallback text if heading missing
      if (!questionText) {
        const textElements = Array.from(item.querySelectorAll('span[dir="auto"], div[dir="auto"]'));
        if (textElements.length > 0) {
          questionText = textElements[0].innerText.trim();
        }
      }

      if (!questionText) return; // Skip non-question cards

      // 2. Multiple Choice (Radio)
      const radioElements = Array.from(item.querySelectorAll('[role="radio"]'));
      if (radioElements.length > 0) {
        const options = radioElements.map((radio) => ({
          text: getOptionLabel(radio),
          element: radio
        })).filter((opt) => opt.text.length > 0);

        questions.push({
          index,
          itemElement: item,
          type: "multiple_choice",
          questionText,
          options
        });
        return;
      }

      // 3. Checkboxes
      const checkboxElements = Array.from(item.querySelectorAll('[role="checkbox"]'));
      if (checkboxElements.length > 0) {
        const options = checkboxElements.map((cb) => ({
          text: getOptionLabel(cb),
          element: cb
        })).filter((opt) => opt.text.length > 0);

        questions.push({
          index,
          itemElement: item,
          type: "checkboxes",
          questionText,
          options
        });
        return;
      }

      // 4. Dropdown Listbox
      const listbox = item.querySelector('[role="listbox"]');
      if (listbox) {
        const optionEls = Array.from(item.querySelectorAll('[role="option"]'));
        const options = optionEls.map((opt) => ({
          text: opt.innerText.trim() || opt.getAttribute("data-value") || "",
          element: opt
        })).filter((o) => o.text && !o.text.toLowerCase().includes("choose"));

        questions.push({
          index,
          itemElement: item,
          type: "dropdown",
          questionText,
          options,
          listboxElement: listbox
        });
        return;
      }

      // 5. Short Answer / Paragraph Text
      const textarea = item.querySelector("textarea");
      if (textarea) {
        questions.push({
          index,
          itemElement: item,
          type: "paragraph",
          questionText,
          options: [],
          inputElement: textarea
        });
        return;
      }

      const textInput = item.querySelector('input[type="text"]:not([style*="display: none"])');
      if (textInput) {
        questions.push({
          index,
          itemElement: item,
          type: "short_answer",
          questionText,
          options: [],
          inputElement: textInput
        });
        return;
      }
    });

    return questions;
  }

  /**
   * Helper to retrieve clean label text for a radio/checkbox option
   */
  function getOptionLabel(controlElement) {
    // Attribute check
    const ariaLabel = controlElement.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const dataValue = controlElement.getAttribute("data-value");
    if (dataValue && dataValue.trim()) return dataValue.trim();

    // Container check
    const row = controlElement.closest('.docssharedWizToggleLabeledContainer, .Od2TWd, .SG0Aua, label') || controlElement.parentElement;
    if (row) {
      const textSpan = row.querySelector('.aDTYNe, .s392dd, span[dir="auto"], .OvPDhc');
      if (textSpan && textSpan.innerText.trim()) {
        return textSpan.innerText.trim();
      }
      return row.innerText.trim();
    }

    return "";
  }

  /**
   * Simulates full mouse and pointer events for Google Forms components
   */
  function simulateClick(element) {
    if (!element) return;

    const eventOpts = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new PointerEvent("pointerdown", eventOpts));
    element.dispatchEvent(new MouseEvent("mousedown", eventOpts));
    element.dispatchEvent(new PointerEvent("pointerup", eventOpts));
    element.dispatchEvent(new MouseEvent("mouseup", eventOpts));
    element.click();

    // Fallback: If aria-checked is still false, trigger the parent row wrapper
    setTimeout(() => {
      if (element.getAttribute("aria-checked") !== "true") {
        const parentRow = element.closest('.docssharedWizToggleLabeledContainer, .Od2TWd, .SG0Aua, label');
        if (parentRow && parentRow !== element) {
          parentRow.click();
        }
      }
    }, 40);
  }

  /**
   * Simulates typing into Google Forms text input and dispatches framework events
   */
  function simulateTextInput(inputEl, text) {
    if (!inputEl) return;
    inputEl.focus();
    inputEl.value = text;

    inputEl.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

    try {
      inputEl.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text
      }));
    } catch (_) {}

    inputEl.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));
  }

  /**
   * Applies the solved answers into the DOM
   */
  async function applyAnswersToDOM(questionsData, aiAnswers) {
    if (!Array.isArray(aiAnswers)) return 0;
    let filled = 0;

    for (const ansItem of aiAnswers) {
      const q = questionsData.find((qData) => qData.index === ansItem.index);
      if (!q) continue;

      const targetAnswers = Array.isArray(ansItem.answers) ? ansItem.answers : [ansItem.answers];

      if (q.type === "multiple_choice" || q.type === "checkboxes") {
        let matchedAny = false;
        for (const targetText of targetAnswers) {
          if (!targetText) continue;
          const match = findBestMatchingOption(q.options, targetText);
          if (match && match.element) {
            const isChecked = match.element.getAttribute("aria-checked") === "true";
            if (!isChecked) {
              simulateClick(match.element);
              matchedAny = true;
            } else {
              matchedAny = true;
            }
          }
        }
        if (matchedAny) filled++;
      } else if (q.type === "dropdown") {
        for (const targetText of targetAnswers) {
          const match = findBestMatchingOption(q.options, targetText);
          if (match && match.element) {
            if (q.listboxElement) {
              simulateClick(q.listboxElement);
              await new Promise((r) => setTimeout(r, 80));
            }
            simulateClick(match.element);
            filled++;
          }
        }
      } else if (q.type === "short_answer" || q.type === "paragraph") {
        if (q.inputElement && targetAnswers.length > 0) {
          simulateTextInput(q.inputElement, String(targetAnswers[0]));
          filled++;
        }
      }

      await new Promise((r) => setTimeout(r, 50));
    }

    return filled;
  }

  /**
   * Robust option matcher
   */
  function findBestMatchingOption(options, target) {
    if (!options || options.length === 0 || !target) return null;

    const clean = (str) =>
      String(str)
        .toLowerCase()
        .replace(/^[a-z0-9][\.\)\-\:]\s*/i, "") // Strip leading "A.", "1)", etc.
        .replace(/[\r\n\t]/g, " ")
        .trim();

    const targetClean = clean(target);

    // 1. Exact match on cleaned text
    let matched = options.find((opt) => clean(opt.text) === targetClean);
    if (matched) return matched;

    // 2. Contains match
    matched = options.find((opt) => {
      const optClean = clean(opt.text);
      return optClean.includes(targetClean) || targetClean.includes(optClean);
    });

    return matched || null;
  }
})();
