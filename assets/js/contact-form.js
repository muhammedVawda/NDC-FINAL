/*
  Callback / contact form.

  Behaviour contract (each point is covered by the browser QA in the repo's
  test notes):
    - Validation runs on submit; errors appear beside the field, values are kept.
    - "Success" is shown ONLY after the backend accepts the request (HTTP 200
      with { success: true }). Anything else is an honest error that offers the
      phone number, and the visitor's details stay in the form.
    - The submit button is disabled while sending, so a double-click or a
      second tap cannot send twice.
    - Spam: a hidden honeypot field and a minimum-time check (the form records
      when it was shown; the server enforces the same minimum).
    - Nothing the visitor typed is ever inserted as HTML.
*/
(function () {
  "use strict";

  var PHONE_DISPLAY = "(021) 054 1141";
  var PHONE_HREF = "tel:+27210541141";

  // Resolved lazily: sa-validate.js is a deferred script that may run after this one.
  function V() { return window.NDCValidate; }

  // Best-effort client-side rate limit. Real protection lives server-side
  // (see netlify/functions/contact.js) — this just discourages accidental
  // repeat clicks / naive scripted abuse in a single page session.
  var submitTimestamps = [];
  function rateLimited() {
    var now = Date.now();
    submitTimestamps = submitTimestamps.filter(function (t) { return now - t < 60000; });
    return submitTimestamps.length >= 3;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * Render an alert. `parts` is an array of strings and { tel: true } markers,
   * assembled with textContent/createElement so no value is parsed as HTML.
   */
  function setAlert(mount, type, parts) {
    if (!mount) return;
    mount.textContent = "";
    if (!parts) return;
    var box = el("div", "form-alert form-alert--" + type);
    box.setAttribute("role", type === "error" ? "alert" : "status");
    (Array.isArray(parts) ? parts : [parts]).forEach(function (part) {
      if (part && part.tel) {
        var a = el("a", null, PHONE_DISPLAY);
        a.href = PHONE_HREF;
        box.appendChild(a);
      } else {
        box.appendChild(document.createTextNode(part));
      }
    });
    mount.appendChild(box);
    // Bring the outcome into view: on a phone the alert can sit above the fold.
    if (box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
  }

  function wireForm(form) {
    var mount = form.parentElement ? form.parentElement.querySelector("[data-form-alert-mount]") : null;
    var submitBtn = form.querySelector("[data-submit-btn]");
    var submitting = false;
    // When the form first existed on screen; the server enforces a minimum
    // gap between this and the submission.
    var shownAt = Date.now();

    function fieldWrap(name) {
      return form.querySelector('[data-field="' + name + '"]');
    }
    function setFieldError(name, message) {
      var wrap = fieldWrap(name);
      if (!wrap) return;
      var errorEl = wrap.querySelector(".error");
      var input = wrap.querySelector("input, select, textarea");
      if (message) {
        wrap.setAttribute("data-invalid", "true");
        if (errorEl) errorEl.textContent = message;
        if (input) input.setAttribute("aria-invalid", "true");
      } else {
        wrap.removeAttribute("data-invalid");
        if (input) input.removeAttribute("aria-invalid");
      }
    }

    function validate(data) {
      var firstBad = null;
      function flag(name, message) {
        setFieldError(name, message);
        if (message && !firstBad) firstBad = fieldWrap(name);
      }

      flag("name", !data.name || !data.name.trim() ? "Please enter your name." : "");
      flag("phone", V().isValidSAPhone(data.phone) ? "" : V().PHONE_HELP);
      flag(
        "email",
        data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)
          ? "Please enter a valid email address, or leave it blank."
          : ""
      );
      flag("consent", data.consent ? "" : "Please tick the box so we are allowed to contact you.");

      // Put the visitor on the first problem, in page order.
      var bad = form.querySelector('[data-invalid="true"]');
      if (bad) {
        var field = bad.querySelector("input, select, textarea");
        // An error inside the collapsed "more details" panel must open it.
        var prefs = bad.closest("details");
        if (prefs) prefs.open = true;
        if (field) {
          // A just-opened <details> is not rendered until styles are recalculated, and
          // an unrendered field cannot take focus, so flush layout first and retry once
          // on the next frame if the browser still refused.
          void form.offsetHeight;
          field.focus();
          if (document.activeElement !== field && window.requestAnimationFrame) {
            window.requestAnimationFrame(function () { field.focus(); });
          }
        }
      }
      return !bad;
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
        language: (formData.get("language") || "").toString(),
        message: (formData.get("message") || "").toString(),
        consent: formData.get("consent") === "on",
        marketing: formData.get("marketing") === "on",
        honeypot: (formData.get("company") || "").toString(),
        formShownAt: shownAt,
        pageRef: new URLSearchParams(window.location.search).get("ref") || "",
      };

      setAlert(mount, "", null);

      if (data.honeypot) {
        // Bots that fill the hidden field get a quiet "success" and nothing is sent.
        setAlert(mount, "success", "Thanks, we have received your request.");
        form.reset();
        return;
      }

      if (!validate(data)) {
        setAlert(mount, "error", "Please check the highlighted fields and try again.");
        return;
      }

      if (rateLimited()) {
        setAlert(mount, "error", "You have submitted a few requests in a short time. Please wait a minute and try again.");
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
            var first = (data.name.trim().split(/\s+/)[0] || "").slice(0, 40);
            setAlert(mount, "success", "Thanks" + (first ? ", " + first : "") + ". We have received your request and a consultant will call you back.");
            form.reset();
            shownAt = Date.now(); // a fresh form for any further request
            form.querySelectorAll(".field").forEach(function (w) { w.removeAttribute("data-invalid"); });
            if (window.ndcTrack) window.ndcTrack("callback_submitted", { service: data.service || "unspecified" });
          } else {
            // The server's own message when it gave one (it never contains user input),
            // always followed by a way through.
            var reason = result.body && result.body.message;
            setAlert(mount, "error", [
              (reason ? reason + " " : "We could not send your request just now. ") +
                "Your details are still in the form, so you can try again, or call us on ",
              { tel: true },
              ".",
            ]);
          }
        })
        .catch(function () {
          setAlert(mount, "error", [
            "We could not reach our server. Please check your connection and try again; your details are still in the form. You can also call us on ",
            { tel: true },
            ".",
          ]);
        })
        .finally(function () {
          submitting = false;
          if (submitBtn) {
            submitBtn.removeAttribute("aria-busy");
            submitBtn.removeAttribute("disabled");
            submitBtn.textContent = submitBtn.dataset.originalText || "Request my callback";
          }
        });
    });
  }

  document.querySelectorAll("[data-callback-form]").forEach(wireForm);
})();
