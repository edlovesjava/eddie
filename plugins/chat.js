// Built-in plugin: AI chat panel.
// Proves the panel architecture: this whole feature lives in a plugin — a
// registerPanel call plus the server's /api/ai/chat endpoint, which pipes the
// prompt to a local CLI (the `claude` CLI by default; change ai.command in
// /settings). Nothing in core knows chat exists.
(() => {
  const messages = [];
  let thread = null; // trace thread id — keeps the conversation auditable

  eddie.registerPanel("chat", {
    title: "AI chat (runs your local claude CLI)",
    button: "Chat",
    render(el) {
      el.innerHTML = `
        <h3>ai chat</h3>
        <div class="chat-log" id="chat-log"></div>
        <textarea id="chat-input" rows="3" placeholder="Ask about this document… (Cmd+Enter to send)"></textarea>
        <div class="chat-actions">
          <label><input type="checkbox" id="chat-ctx" checked> include document</label>
          <button id="chat-send">Send</button>
        </div>`;
      const log = el.querySelector("#chat-log");
      const input = el.querySelector("#chat-input");
      const sendBtn = el.querySelector("#chat-send");

      function addMsg(role, html, cls = "") {
        const div = document.createElement("div");
        div.className = `chat-msg ${role} ${cls}`.trim();
        div.innerHTML = html;
        log.appendChild(div);
        div.scrollIntoView({ block: "end" });
        return div;
      }

      async function send() {
        const text = input.value.trim();
        if (!text || sendBtn.disabled) return;
        input.value = "";
        messages.push({ role: "user", text });
        addMsg("user", eddie.markdown(text));
        const pending = addMsg("assistant", "thinking…", "pending");
        sendBtn.disabled = true;
        try {
          const body = { messages, path: eddie.getPath(), thread };
          if (el.querySelector("#chat-ctx").checked && eddie.getPath()) {
            body.context = { path: eddie.getPath(), language: eddie.getLanguage(), text: eddie.getText() };
          }
          const r = await eddie.api("POST", "/api/ai/chat", body);
          thread = r.thread || thread;
          messages.push({ role: "assistant", text: r.reply });
          pending.classList.remove("pending");
          pending.innerHTML = eddie.markdown(r.reply);
        } catch (e) {
          pending.classList.remove("pending");
          pending.innerHTML = `<em>error: ${e.message}</em>`;
        } finally {
          sendBtn.disabled = false;
          input.focus();
        }
      }

      sendBtn.onclick = send;
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          send();
        }
      });
    },
    onShow(el) {
      el.querySelector("#chat-input").focus();
    },
  });
})();
