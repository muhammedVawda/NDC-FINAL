(function () {
  "use strict";

  function isValidSAPhone(raw) {
    var digits = String(raw || "").replace(/[\s\-()]/g, "");
    if (/^\+27[1-9][0-9]{8}$/.test(digits)) return true;
    if (/^27[1-9][0-9]{8}$/.test(digits)) return true;
    if (/^0[1-9][0-9]{8}$/.test(digits)) return true;
    return false;
  }

  // Best-effort client-side rate limit. Real protection lives server-side
  // (see netlify/functions/contact.js) — this just discourages accidental
  // repeat clicks / naive scripted abuse in a single page session.
  var submitTimestamps = [];
  function rateLimited() {
    var now = Date.now();
    submitTimestamps = submitTimestamps.filter(function (t) { return now - t < 60000; });
    return submitTimestamps.length >= 3;
  }

  function setAlert(mount, type, message) {
    if (!mount) return;
    if (!message) {
      mount.innerHTML = "";
      return;
    }
    mount.innerHTML = '<div class="form-alert form-alert--' + type + '" role="alert">' + message + "</div>";
  }

  function wireForm(form) {
    var mount = form.parentElement ? form.parentElement.querySelector("[data-form-alert-mount]") : null;
    var submitBtn = form.querySelector("[data-submit-btn]");
    var submitting = false;

    function fieldWrap(name) {
      return form.querySelector('[data-field="' + name + '"]');
    }
    function setFieldError(name, message) {
      var wrap = fieldWrap(name);
      if (!wrap) return;
      var errorEl = wrap.querySelector(".error");
      if (message) {
        wrap.setAttribute("data-invalid", "true");
        if (errorEl) errorEl.textContent = message;
      } else {
        wrap.removeAttribute("data-invalid");
      }
    }

    function validate(data) {
      var ok = true;
      if (!data.name || !data.name.trim()) {
        setFieldError("name", "Please enter your name.");
        ok = false;
      } else {
        setFieldError("name", "");
      }

      if (!isValidSAPhone(data.phone)) {
        setFieldError("phone", "Please enter a valid South African contact number.");
        ok = false;
      } else {
        setFieldError("phone", "");
      }

      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        setFieldError("email", "Please enter a valid email address, or leave it blank.");
        ok = false;
      } else {
        setFieldError("email", "");
      }

      if (!data.consent) {
        setFieldError("consent", "Please provide consent so we can contact you.");
        ok = false;
      } else {
        setFieldError("consent", "");
      }

      return ok;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (submitting) return;

      var formData = new FormData(form);
      var data = {
        name: (formData.get("name") || "").toString(),
        phone: (formData.get("phone") || "").toString(),
        email: (formData.get("email") || "").toString(),
        service: (formData.get("service") || "").toString(),
        callbackTime: (formData.get("callbackTime") || "").toString(),
        message: (formData.get("message") || "").toString(),
        consent: formData.get("consent") === "on",
        marketing: formData.get("marketing") === "on",
        honeypot: (formData.get("company") || "").toString(),
        pageRef: new URLSearchParams(window.location.search).get("ref") || "",
      };

      setAlert(mount, "", "");

      if (data.honeypot) {
        // Silently treat as success for bots, without contacting the backend.
        setAlert(mount, "success", "Thanks — we've received your request.");
        form.reset();
        return;
      }

      if (!validate(data)) {
        setAlert(mount, "error", "Please check the highlighted fields and try again.");
        return;
      }

      if (rateLimited()) {
        setAlert(mount, "error", "You've submitted a few requests in a short time. Please wait a minute before trying again.");
        return;
      }

      submitting = true;
      submitTimestamps.push(Date.now());
      if (submitBtn) {
        submitBtn.setAttribute("aria-busy", "true");
        submitBtn.setAttribute("disabled", "true");
        submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
        submitBtn.textContent = "Sending…";
      }

      fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            return { ok: response.ok, body: body };
          });
        })
        .then(function (result) {
          if (result.ok && result.body && result.body.success) {
            setAlert(mount, "success", "Thanks, " + (data.name.split(" ")[0] || "") + " — we've received your request and someone will be in touch.");
            form.reset();
            form.querySelectorAll(".field").forEach(function (w) { w.removeAttribute("data-invalid"); });
            if (window.ndcTrack) window.ndcTrack("callback_submitted", { service: data.service || "unspecified" });
          } else {
            var reason = (result.body && result.body.message) || "We couldn't send your request right now. Please try again shortly.";
            setAlert(mount, "error", reason);
          }
        })
        .catch(function () {
          setAlert(mount, "error", "We couldn't reach our server. Please check your connection and try again — your details haven't been lost.");
        })
        .finally(function () {
          submitting = false;
          if (submitBtn) {
            submitBtn.removeAttribute("aria-busy");
            submitBtn.removeAttribute("disabled");
            submitBtn.textContent = submitBtn.dataset.originalText || "Submit";
          }
        });
    });
  }

  document.querySelectorAll("[data-callback-form]").forEach(wireForm);
})();
