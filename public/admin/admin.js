const loginPanel = document.querySelector("#login-panel"),
  editorPanel = document.querySelector("#editor-panel"),
  message = document.querySelector("#message"),
  fields = [
    "heroAnnouncement",
    "partnerKicker",
    "partnerHeading",
    "partnerBody",
    "buyImage",
    "spoImage",
    "drepImage",
  ];
const request = async (url, options) => {
  const response = await fetch(url, options),
    data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};
const showLogin = () => {
  loginPanel.hidden = false;
  editorPanel.hidden = true;
};
const showEditor = async () => {
  const content = await request("/api/admin/content");
  for (const key of fields)
    document.querySelector(`#${key}`).value = content[key] || "";
  for (const key of ["buyImage", "spoImage", "drepImage"])
    document.querySelector(`#${key}Preview`).src = content[key] || "";
  loginPanel.hidden = true;
  editorPanel.hidden = false;
};
document
  .querySelector("#login-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Signing in…";
    try {
      await request("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: document.querySelector("#password").value,
        }),
      });
      document.querySelector("#password").value = "";
      await showEditor();
      message.textContent = "";
    } catch (error) {
      message.textContent = error.message;
    }
  });
document
  .querySelector("#content-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Saving…";
    try {
      const body = Object.fromEntries(
        fields.map((key) => [key, document.querySelector(`#${key}`).value]),
      );
      await request("/api/admin/content", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      message.textContent = "Saved. The live homepage has been updated.";
    } catch (error) {
      message.textContent = error.message;
    }
  });

const readFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });

document.querySelectorAll("[data-image-field]").forEach((input) => {
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const field = input.dataset.imageField;
    message.textContent = "Uploading image...";
    input.disabled = true;
    try {
      const upload = await request("/api/admin/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl: await readFile(file), slot: input.dataset.imageSlot }),
      });
      document.querySelector(`#${field}`).value = upload.url;
      document.querySelector(`#${field}Preview`).src = upload.url;
      message.textContent = "Image uploaded. Click Save changes to publish it.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      input.disabled = false;
    }
  });
});

document.querySelector("#logout").addEventListener("click", async () => {
  await request("/api/admin/session", { method: "DELETE" });
  showLogin();
  message.textContent = "Signed out.";
});
request("/api/admin/session")
  .then((session) => (session.authenticated ? showEditor() : showLogin()))
  .catch((error) => {
    showLogin();
    message.textContent = error.message;
  });
