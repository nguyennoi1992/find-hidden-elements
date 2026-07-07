function getSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (typeof el.className === "string" && el.className.trim()) {
        const cls = el.className.trim().split(/\s+/).map(CSS.escape).join(".");
        return `${el.tagName.toLowerCase()}.${cls}`;
    }
    return el.tagName.toLowerCase();
}

function isRestrictedUrl(url) {
    return !url ||
        url.startsWith("chrome://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:") ||
        url.startsWith("chrome-extension://");
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab || isRestrictedUrl(tab.url)) {
        throw new Error("This page cannot be controlled by the extension.");
    }
    return tab;
}

function showMessage(message) {
    const resultList = document.getElementById("result");
    resultList.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = message;
    resultList.appendChild(li);
}

async function runInActiveTab(func, args = []) {
    const tab = await getActiveTab();
    return chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func,
        args
    });
}

function cleanReaderPopups(options = {}) {
    const settings = {
        observe: Boolean(options.observe),
        repeat: options.repeat ?? 3,
        repeatDelay: options.repeatDelay ?? 450
    };

    const adPattern = /google_vignette|googlesyndication|googleadservices|googleads|doubleclick|adsbygoogle|adservice|advert|interstitial|vignette|popup|modal|overlay|lightbox|backdrop|aswift|googlefc|fc-ab-root|fbsplash|amp-ad/i;
    const readerPattern = /chapter|truyen|story|novel|entry-content|post-content|reading|content|article|main/i;
    const removedNodes = new WeakSet();
    const stats = {
        removed: 0,
        unlocked: 0,
        unblurred: 0,
        urlCleaned: 0,
        observer: false
    };

    function nodeName(el) {
        return [
            el.id || "",
            typeof el.className === "string" ? el.className : "",
            el.getAttribute("aria-label") || "",
            el.getAttribute("role") || "",
            el.getAttribute("src") || "",
            el.getAttribute("data-ad-client") || "",
            el.getAttribute("data-google-query-id") || ""
        ].join(" ");
    }

    function hasReaderText(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        const name = nodeName(el);
        const textLength = (el.innerText || el.textContent || "").trim().length;
        return textLength > 700 && readerPattern.test(name);
    }

    function viewportCoverage(rect) {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        const visibleWidth = Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
        return (visibleWidth * visibleHeight) / (width * height);
    }

    function looksLikePopup(el) {
        if (!el || removedNodes.has(el) || el === document.body || el === document.documentElement) {
            return false;
        }

        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const name = nodeName(el);
        const tag = el.tagName.toLowerCase();
        const zIndex = Number.parseInt(style.zIndex, 10);
        const positioned = ["fixed", "sticky", "absolute"].includes(style.position);
        const coverage = viewportCoverage(rect);
        const highLayer = positioned && (!Number.isNaN(zIndex) ? zIndex >= 90 : style.position === "fixed");
        const hasAdName = adPattern.test(name);
        const modalRole = el.getAttribute("aria-modal") === "true" || /dialog|alertdialog/i.test(el.getAttribute("role") || "");
        const blocksPage = highLayer && rect.width >= 120 && rect.height >= 80 && coverage >= 0.08;
        const fullScreenShade = highLayer && coverage >= 0.35 && Number.parseFloat(style.opacity || "1") >= 0.2;
        const iframeAd = tag === "iframe" && (hasAdName || (highLayer && coverage >= 0.04));
        const insAd = tag === "ins" && hasAdName && highLayer;

        if (hasReaderText(el) && !modalRole && !iframeAd) return false;
        if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") return false;

        return iframeAd || insAd || modalRole || (hasAdName && blocksPage) || fullScreenShade;
    }

    function removeElement(el) {
        if (!el || removedNodes.has(el)) return false;
        removedNodes.add(el);
        el.remove();
        stats.removed += 1;
        return true;
    }

    function popupContainerFor(el) {
        let current = el;
        let best = el;
        while (current && current.parentElement && current.parentElement !== document.body) {
            const parent = current.parentElement;
            const style = window.getComputedStyle(parent);
            const rect = parent.getBoundingClientRect();
            const zIndex = Number.parseInt(style.zIndex, 10);
            const highLayer = ["fixed", "sticky", "absolute"].includes(style.position) &&
                (!Number.isNaN(zIndex) ? zIndex >= 90 : style.position === "fixed");
            const popupSized = rect.width >= 120 && rect.height >= 80 && viewportCoverage(rect) >= 0.03;

            if (hasReaderText(parent)) break;
            if (highLayer && popupSized) best = parent;
            current = parent;
        }
        return best;
    }

    function unlockPage() {
        [document.documentElement, document.body].forEach(el => {
            if (!el) return;
            const style = window.getComputedStyle(el);
            if (style.overflow === "hidden" || style.position === "fixed") {
                el.style.overflow = "auto";
                el.style.position = "";
                el.style.height = "";
                stats.unlocked += 1;
            }
        });

        document.querySelectorAll("*").forEach(el => {
            const style = window.getComputedStyle(el);
            const hasBlur = /blur\(/i.test(style.filter || "") || /blur\(/i.test(style.backdropFilter || "");
            if (hasBlur && hasReaderText(el)) {
                el.style.filter = "none";
                el.style.backdropFilter = "none";
                stats.unblurred += 1;
            }
            if (style.pointerEvents === "none" && hasReaderText(el)) {
                el.style.pointerEvents = "auto";
            }
        });
    }

    function cleanUrl() {
        if (location.hash === "#google_vignette") {
            history.replaceState(null, "", location.pathname + location.search);
            stats.urlCleaned = 1;
        }
    }

    function cleanOnce() {
        cleanUrl();
        unlockPage();

        const candidates = [
            ...document.querySelectorAll("iframe, ins, [id], [class], [role='dialog'], [aria-modal='true']")
        ];

        candidates.forEach(el => {
            if (looksLikePopup(el)) {
                removeElement(popupContainerFor(el));
            }
        });

        document.querySelectorAll("body > div, body > section, body > aside").forEach(el => {
            if (looksLikePopup(el)) {
                removeElement(el);
            }
        });
    }

    if (window.__readerPopupCleaner?.observer) {
        window.__readerPopupCleaner.observer.disconnect();
    }

    cleanOnce();

    let rounds = 1;
    const repeatTimer = setInterval(() => {
        rounds += 1;
        cleanOnce();
        if (rounds >= settings.repeat) clearInterval(repeatTimer);
    }, settings.repeatDelay);

    if (settings.observe) {
        const observer = new MutationObserver(() => cleanOnce());
        observer.observe(document.documentElement, {childList: true, subtree: true});
        window.__readerPopupCleaner = {observer};
        stats.observer = true;
        setTimeout(() => observer.disconnect(), 30000);
    }

    return stats;
}

document.getElementById("cleanReader").addEventListener("click", async () => {
    try {
        const results = await runInActiveTab(cleanReaderPopups, [{observe: true, repeat: 5}]);
        const stats = results?.[0]?.result || {};
        showMessage(`Cleaned reader popup: removed ${stats.removed || 0}, unlocked ${stats.unlocked || 0}, unblurred ${stats.unblurred || 0}.`);
    } catch (error) {
        showMessage(`Cannot clean this page: ${error.message}`);
    }
});

document.getElementById("scan").addEventListener("click", async () => {
    let tab;
    try {
        tab = await getActiveTab();
    } catch (error) {
        showMessage(`Warning: ${error.message}`);
        return;
    }

    const results = await chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func: () => {
            const found = [];

            function getSelector(el) {
                if (el.id) return `#${CSS.escape(el.id)}`;
                if (typeof el.className === "string" && el.className.trim()) {
                    const cls = el.className.trim().split(/\s+/).map(CSS.escape).join(".");
                    return `${el.tagName.toLowerCase()}.${cls}`;
                }
                return el.tagName.toLowerCase();
            }

            document.querySelectorAll("*").forEach(el => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();

                if (style.display === "none" && el.querySelector("p") && (el.id || el.className)) {
                    found.push({
                        id: el.id || "",
                        class: typeof el.className === "string" ? el.className : "",
                        selector: getSelector(el),
                        type: "hidden"
                    });
                }

                const zIndex = parseInt(style.zIndex, 10);
                if ((style.position === "absolute" || style.position === "fixed") &&
                    !Number.isNaN(zIndex) && zIndex >= 90 &&
                    parseFloat(style.opacity) <= 0.1 &&
                    rect.width > 50 && rect.height > 50) {
                    found.push({
                        id: el.id || "",
                        class: typeof el.className === "string" ? el.className : "",
                        selector: getSelector(el),
                        type: "overlay-redirect"
                    });
                }

                if (el.tagName.toLowerCase() === "a" || el.tagName.toLowerCase() === "button") {
                    const isOffScreen = parseInt(style.left, 10) < -900 || parseInt(style.top, 10) < -900;
                    const isInvisible = parseFloat(style.opacity) === 0 || style.visibility === "hidden";
                    const isTiny = rect.width <= 1 && rect.height <= 1 && rect.width >= 0 && rect.height >= 0;

                    if (isOffScreen || isInvisible || isTiny) {
                        found.push({
                            id: el.id || "",
                            class: typeof el.className === "string" ? el.className : "",
                            selector: getSelector(el),
                            type: "hidden-link"
                        });
                    }
                }
            });

            document.querySelectorAll("*[id*='popup'], *[id*='dialog'], *[class*='popup'], *[class*='dialog'], *[class*='overlay'], *[id*='overlay']")
                .forEach(el => {
                    found.push({
                        id: el.id || "",
                        class: typeof el.className === "string" ? el.className : "",
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
            const idSpan = document.createElement("span");
            const classSpan = document.createElement("span");
            const toggleButton = document.createElement("button");
            const removeButton = document.createElement("button");

            idSpan.className = "id";
            idSpan.textContent = el.id || "-";
            classSpan.className = "class";
            classSpan.textContent = el.class || "-";

            toggleButton.textContent = "Toggle";
            toggleButton.dataset.selector = el.selector;
            toggleButton.dataset.action = "toggle";
            removeButton.textContent = "Remove";
            removeButton.dataset.selector = el.selector;
            removeButton.dataset.action = "remove";

            li.append(`[${el.type}] ID: `, idSpan, ", Class: ", classSpan, " ");
            li.append(toggleButton, " ", removeButton);
            resultList.appendChild(li);
        });

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
                            el.remove();
                        }
                    },
                    args: [selector, action]
                });
            });
        });

    } else {
        showMessage("No hidden/popup elements found.");
    }
});

document.getElementById("removeAll").addEventListener("click", async () => {
    try {
        const results = await runInActiveTab(cleanReaderPopups, [{observe: false, repeat: 2}]);
        const stats = results?.[0]?.result || {};
        showMessage(`Removed popup-like elements: ${stats.removed || 0}. Links inside story content were preserved.`);
    } catch (error) {
        showMessage(`Cannot remove popups: ${error.message}`);
    }
});

let toggleState = true;
document.getElementById("toggleAll").addEventListener("click", async () => {
    try {
        await runInActiveTab((state) => {
            const all = [];
            document.querySelectorAll("*").forEach(el => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();

                if (style.display === "none") {
                    all.push(el);
                    return;
                }

                const zIndex = parseInt(style.zIndex, 10);
                if ((style.position === "absolute" || style.position === "fixed") &&
                    !Number.isNaN(zIndex) && zIndex >= 90 &&
                    parseFloat(style.opacity) <= 0.1 &&
                    rect.width > 50 && rect.height > 50) {
                    all.push(el);
                    return;
                }

                if (el.tagName.toLowerCase() === "a" || el.tagName.toLowerCase() === "button") {
                    const isOffScreen = parseInt(style.left, 10) < -900 || parseInt(style.top, 10) < -900;
                    const isInvisible = parseFloat(style.opacity) === 0 || style.visibility === "hidden";
                    const isTiny = rect.width <= 1 && rect.height <= 1;
                    if (isOffScreen || isInvisible || isTiny) {
                        all.push(el);
                    }
                }
            });
            document.querySelectorAll("*[id*='popup'], *[id*='dialog'], *[class*='popup'], *[class*='dialog']")
                .forEach(el => all.push(el));

            all.forEach(el => {
                if (state) {
                    el.style.display = "block";
                    el.style.opacity = "1";
                    el.style.visibility = "visible";
                    el.style.border = "2px solid red";
                } else {
                    el.style.display = "none";
                }
            });
        }, [toggleState]);
        toggleState = !toggleState;
    } catch (error) {
        showMessage(`Cannot toggle this page: ${error.message}`);
    }
});
