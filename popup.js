// FormSense - Popup Settings Script
document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("apiKey");
  const modelSelect = document.getElementById("modelSelect");
  const saveBtn = document.getElementById("saveBtn");
  const solveNowBtn = document.getElementById("solveNowBtn");
  const toggleKeyBtn = document.getElementById("toggleKey");
  const statusMsg = document.getElementById("statusMsg");

  // Load existing configuration from chrome.storage.local
  chrome.storage.local.get(["apiKey", "model"], (data) => {
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
      fetchAndPopulateModels(data.apiKey, data.model);
    } else if (data.model) {
      modelSelect.value = data.model;
    }
  });

  // Dynamically fetch and list active models for this user's API key
  function fetchAndPopulateModels(apiKey, selectedModel) {
    if (!apiKey) return;
    chrome.runtime.sendMessage({ action: "FETCH_AVAILABLE_MODELS", apiKey }, (res) => {
      if (res && res.success && Array.isArray(res.models) && res.models.length > 0) {
        modelSelect.innerHTML = "";
        res.models.forEach((modelName) => {
          const opt = document.createElement("option");
          opt.value = modelName;
          opt.textContent = modelName;
          if (selectedModel && selectedModel === modelName) {
            opt.selected = true;
          }
          modelSelect.appendChild(opt);
        });

        // If no model selected, default to 3.8-flash or first flash model
        if (!selectedModel || !res.models.includes(selectedModel)) {
          const best =
            res.models.find((m) => m.includes("3.8-flash")) ||
            res.models.find((m) => m.includes("3.5-flash-lite")) ||
            res.models.find((m) => m.includes("flash")) ||
            res.models[0];
          modelSelect.value = best;
          chrome.storage.local.set({ model: best });
        }
      }
    });
  }

  // Toggle API Key visibility
  toggleKeyBtn.addEventListener("click", () => {
    if (apiKeyInput.type === "password") {
      apiKeyInput.type = "text";
      toggleKeyBtn.textContent = "🔒";
    } else {
      apiKeyInput.type = "password";
      toggleKeyBtn.textContent = "👁";
    }
  });

  // Whenever the user changes the API key input, refresh models
  apiKeyInput.addEventListener("change", () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      fetchAndPopulateModels(key, modelSelect.value);
    }
  });

  // Save settings handler
  saveBtn.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!apiKey) {
      showStatus("Please enter a valid Gemini API key.", "error");
      return;
    }

    chrome.storage.local.set({ apiKey, model }, () => {
      showStatus("Settings saved successfully ✓", "success");
      fetchAndPopulateModels(apiKey, model);
    });
  });

  // Direct trigger "Solve Active Google Form"
  solveNowBtn.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!apiKey) {
      showStatus("Save your API key first!", "error");
      return;
    }

    await chrome.storage.local.set({ apiKey, model });

    showStatus("Solving started on active Google Form tab...", "info");

    chrome.runtime.sendMessage({ action: "POPUP_TRIGGER_SOLVE" }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus(`Error: ${chrome.runtime.lastError.message}`, "error");
        return;
      }
      if (response && !response.success) {
        showStatus(response.error, "error");
      } else {
        showStatus("Solving in progress! Check your Google Form tab.", "success");
      }
    });
  });

  function showStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = `status-msg ${type}`;
  }
});
