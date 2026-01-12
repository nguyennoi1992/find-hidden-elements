function getSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.className) {
        const cls = el.className.trim().split(/\s+/).join(".");
        return `${el.tagName.toLowerCase()}.${cls}`;
    }
    return el.tagName.toLowerCase();
}

document.getElementById("scan").addEventListener("click", async () => {
    let [tab] = await chrome.tabs.query({active: true, currentWindow: true});

    // 🔒 Guard: skip restricted pages
    if (!tab.url ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("about:") ||
        tab.url.startsWith("chrome-extension://")) {

        const resultList = document.getElementById("result");
        resultList.innerHTML = "<li>⚠️ This page cannot be scanned (restricted by browser).</li>";
        return;
    }

    // Inject scanning code into the page
    const results = await chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func: () => {
            const found = [];

            function getSelector(el) {
                if (el.id) return `#${el.id}`;
                if (el.className) {
                    const cls = el.className.trim().split(/\s+/).join(".");
                    return `${el.tagName.toLowerCase()}.${cls}`;
                }
                return el.tagName.toLowerCase();
            }

            // 1. Truly hidden elements (with id or class)
            document.querySelectorAll("*").forEach(el => {
                if (window.getComputedStyle(el).display === "none"
                    && el.querySelector("p")
                    && (el.id !== "" || el.className !== "")) {
                    found.push({
                        id: el.id || "",
                        class: el.className || "",
                        selector: getSelector(el),
                        type: "hidden"
                    });
                }
            });

            // 2. Popup/dialog elements
            document.querySelectorAll("*[id*='popup'], *[id*='dialog'], *[class*='popup'], *[class*='dialog']")
                .forEach(el => {
                    found.push({
                        id: el.id || "",
                        class: el.className || "",
                        selector: getSelector(el),
                        type: "popup"
                    });
                });

            return found;
        }
    });

    const resultList = document.getElementById("result");
    resultList.innerHTML = "";
    const items = results?.[0]?.result || [];

    if (items.length > 0) {
        items.forEach((el) => {
            const li = document.createElement("li");
            li.innerHTML = `
              [${el.type}] 
              ID: <span class="id">${el.id || '-'}</span>, 
              Class: <span class="class">${el.class || '-'}</span>
              <button data-selector="${el.selector}" data-action="toggle">&#x1F441; Toggle</button>
              <button data-selector="${el.selector}" data-action="remove">&#x274C; Remove</button>
            `;
            resultList.appendChild(li);
        });

        // Add listeners for per-item buttons
        resultList.querySelectorAll("button[data-selector]").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const selector = e.currentTarget.getAttribute("data-selector");
                const action = e.currentTarget.getAttribute("data-action");

                await chrome.scripting.executeScript({
                    target: {tabId: tab.id},
                    func: (selector, action) => {
                        const el = document.querySelector(selector);
                        if (!el) return;

                        if (action === "toggle") {
                            if (getComputedStyle(el).display === "none") {
                                el.style.display = "block";
                                el.style.border = "2px solid red";
                                el.scrollIntoView({behavior: "smooth", block: "center"});
                            } else {
                                el.style.display = "none";
                            }
                        }

                        if (action === "remove") {
                            const links = el.querySelectorAll("a[href]");
                            links.forEach(link => link.remove());
                            el.style.border = "2px dashed orange";
                            console.log(`Removed ${links.length} hidden/popup link(s)`);
                        }
                    },
                    args: [selector, action]
                });
            });
        });

    } else {
        resultList.innerHTML = "<li>No hidden/popup elements found</li>";
    }
});

// === Extra global buttons ===
document.getElementById("removeAll").addEventListener("click", async () => {
    let [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    await chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func: () => {
            const all = [];

            // 1. Lấy tất cả element đang hidden
            document.querySelectorAll("*").forEach(el => {
                if (window.getComputedStyle(el).display === "none") {
                    all.push(el);
                }
            });

            // 2. Lấy popup, dialog, a (như cũ)
            document.querySelectorAll("*[id*='popup'], *[id*='dialog'], *[class*='popup'], *[class*='dialog']")
                .forEach(el => all.push(el));

            // 3. Remove link trong các element đặc biệt
            all.forEach(el => {
                const link = el.querySelector("a[href]");
                if (link) {
                    link.remove();
                    el.style.border = "2px dashed orange";
                    console.log("Removed link from special element:", link.href);
                }
            });

            // 4. Remove tất cả thẻ <a> còn lại trong trang
            document.querySelectorAll("a[href]").forEach(a => {
                console.log("Removed global link:", a.href);
                a.remove();
            });
        }
    });
});

let toggleState = true;
document.getElementById("toggleAll").addEventListener("click", async () => {
    let [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    await chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func: (state) => {
            const all = [];
            document.querySelectorAll("*").forEach(el => {
                if (window.getComputedStyle(el).display === "none") {
                    all.push(el);
                }
            });
            document.querySelectorAll("*[id*='popup'], *[id*='dialog'], *[class*='popup'], *[class*='dialog']")
                .forEach(el => all.push(el));

            all.forEach(el => {
                if (state) {
                    el.style.display = "block";
                    el.style.border = "2px solid red";
                } else {
                    el.style.display = "none";
                }
            });
        },
        args: [toggleState]
    });
    toggleState = !toggleState;
});
