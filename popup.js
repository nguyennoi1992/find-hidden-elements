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

async function runInActiveTab(func, args = [], world = "ISOLATED") {
    const tab = await getActiveTab();
    const config = {
        target: {tabId: tab.id},
        func,
        args
    };
    if (world) {
        config.world = world;
    }
    return chrome.scripting.executeScript(config);
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

function unlockStoryInTab() {
    const stats = {
        unlocked: false,
        method: "none",
        paragraphsCount: 0
    };

    try {
        sessionStorage.setItem("top", JSON.stringify(true));
        sessionStorage.setItem("adv", JSON.stringify({
            time: Date.now() + 315360000000,
            link: ""
        }));
    } catch (e) {}

    const reopenBtns = Array.from(document.querySelectorAll("button")).filter(b =>
        b.textContent && b.textContent.includes("Mở lại popup")
    );
    for (const btn of reopenBtns) {
        const key = Object.keys(btn).find(k => k.startsWith("__reactProps"));
        if (key && typeof btn[key]?.onClick === "function") {
            try {
                btn[key].onClick({preventDefault() {}, stopPropagation() {}});
            } catch (e) {}
        } else {
            btn.click();
        }
    }

    const links = Array.from(document.querySelectorAll('a[href*="shopee"], a[href*="lazada"], a[href*="s.shopee.vn"]')).concat(
        Array.from(document.querySelectorAll("a")).filter(a => {
            const parent = a.closest("div");
            return parent && parent.innerText && parent.innerText.includes("Mời bạn CLICK vào liên kết");
        })
    );

    for (const link of links) {
        const propsKey = Object.keys(link).find(k => k.startsWith("__reactProps"));
        if (propsKey && typeof link[propsKey]?.onClick === "function") {
            try {
                link[propsKey].onClick({
                    preventDefault() {},
                    stopPropagation() {}
                });
                stats.unlocked = true;
                stats.method = "react_props";
            } catch (e) {}
        }

        const origOpen = window.open;
        try {
            window.open = function () { return null; };
            const clickEvent = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window
            });
            link.addEventListener("click", (e) => e.preventDefault(), {capture: true, once: true});
            link.dispatchEvent(clickEvent);
            stats.unlocked = true;
            if (stats.method === "none") stats.method = "dom_event";
        } catch (e) {
        } finally {
            setTimeout(() => {
                if (window.open !== origOpen) window.open = origOpen;
            }, 150);
        }
    }

    function restoreTextSelection() {
        document.querySelectorAll(".select-none").forEach(el => {
            el.classList.remove("select-none");
            el.style.userSelect = "text";
            el.style.webkitUserSelect = "text";
        });
        document.querySelectorAll(".read_str_content .absolute.inset-0, .read_str_content div.bg-transparent").forEach(el => {
            el.remove();
        });
        document.querySelectorAll(".read_str_content").forEach(el => {
            el.style.userSelect = "text";
            el.style.webkitUserSelect = "text";
            el.style.pointerEvents = "auto";
        });
    }

    function removeLockContainers() {
        document.querySelectorAll("div").forEach(div => {
            const text = div.innerText || "";
            if (text.includes("Mời bạn CLICK vào liên kết bên dưới để mở khóa") ||
                text.includes("Chương đã bị khóa, nếu muốn đọc tiếp")) {
                if (div.classList.contains("text-center") || div.parentElement?.classList.contains("text-center")) {
                    const wrapper = div.classList.contains("text-center") ? div : div.parentElement;
                    wrapper.remove();
                } else {
                    div.remove();
                }
            }
        });
    }

    function injectParagraphs(paragraphText) {
        if (!paragraphText) return false;
        let container = document.querySelector(".read_str_content");
        if (!container) {
            const mainContentDiv = document.querySelector("main div > div");
            if (!mainContentDiv) return false;
            removeLockContainers();
            container = document.createElement("div");
            container.className = "relative mt-6 md:p-4 text-xl read_str_content dark:shadow-2xl";
            mainContentDiv.appendChild(container);
        }

        if (container.querySelectorAll("p").length > 2) {
            restoreTextSelection();
            removeLockContainers();
            return true;
        }

        container.innerHTML = "";
        const lines = paragraphText.replaceAll("\r", "").split("\n");
        for (const line of lines) {
            if (line.trim().length === 0) continue;
            const p = document.createElement("p");
            p.textContent = line;
            p.style.marginBottom = "1rem";
            p.style.lineHeight = "1.8";
            container.appendChild(p);
        }
        restoreTextSelection();
        removeLockContainers();
        return true;
    }

    const content = document.querySelector(".read_str_content");
    let pCount = content ? content.querySelectorAll("p").length : 0;
    if (pCount > 2) {
        restoreTextSelection();
        removeLockContainers();
        stats.unlocked = true;
        stats.paragraphsCount = pCount;
        return stats;
    }

    try {
        const root = document.getElementById("root");
        if (root) {
            const fiberKey = Object.keys(root).find(k => k.startsWith("__reactFiber"));
            if (fiberKey) {
                const queue = [root[fiberKey]];
                let inspected = 0;
                while (queue.length > 0 && inspected < 2000) {
                    inspected++;
                    const cur = queue.shift();
                    if (!cur) continue;
                    let hook = cur.memoizedState;
                    while (hook) {
                        if (hook.memoizedState && typeof hook.memoizedState === "object") {
                            const stateObj = hook.memoizedState;
                            if (typeof stateObj.paragraph === "string" && stateObj.paragraph.trim().length > 50) {
                                if (injectParagraphs(stateObj.paragraph)) {
                                    stats.unlocked = true;
                                    stats.method = "fiber_extracted";
                                    stats.paragraphsCount = document.querySelectorAll(".read_str_content p").length;
                                    return stats;
                                }
                            }
                        }
                        hook = hook.next;
                    }
                    if (cur.child) queue.push(cur.child);
                    if (cur.sibling) queue.push(cur.sibling);
                }
            }
        }
    } catch (e) {}

    const path = window.location.pathname;
    const match = path.match(/\/([^/]+)\/chuong-(\d+)/);
    if (match) {
        const [, slug, chapterNum] = match;
        const token = localStorage.getItem("59d7d5eeb291f4e5");
        const headers = token ? {"Request-Token": token} : {};
        fetch(`/api/public/v2/${slug}/${chapterNum}`, {headers})
            .then(res => res.ok ? res.json() : null)
            .then(json => {
                if (json?.chapter?.paragraph) {
                    injectParagraphs(json.chapter.paragraph);
                }
            })
            .catch(() => {});
    }

    restoreTextSelection();
    stats.paragraphsCount = document.querySelectorAll(".read_str_content p").length;
    return stats;
}

document.getElementById("cleanReader").addEventListener("click", async () => {
    try {
        const results = await runInActiveTab(cleanReaderPopups, [{observe: true, repeat: 5}]);
        try {
            await runInActiveTab(unlockStoryInTab, [], "MAIN");
        } catch (e) {
            await runInActiveTab(unlockStoryInTab, []);
        }
        const stats = results?.[0]?.result || {};
        showMessage(`Cleaned reader popup: removed ${stats.removed || 0}, unlocked ${stats.unlocked || 0}, unblurred ${stats.unblurred || 0}. Story unlock attempted.`);
    } catch (error) {
        showMessage(`Cannot clean this page: ${error.message}`);
    }
});

document.getElementById("unlockStory").addEventListener("click", async () => {
    try {
        let results;
        try {
            results = await runInActiveTab(unlockStoryInTab, [], "MAIN");
        } catch (e) {
            results = await runInActiveTab(unlockStoryInTab, []);
        }
        const stats = results?.[0]?.result || {};
        if (stats.unlocked || stats.paragraphsCount > 0) {
            showMessage(`Story unlocked successfully! (${stats.paragraphsCount || "content"} paragraphs visible)`);
        } else {
            showMessage("No affiliate lock found or story is already unlocked.");
        }
    } catch (error) {
        showMessage(`Cannot unlock story: ${error.message}`);
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

            // Extract and normalize display value from inline style attribute
            function getInlineDisplay(el) {
                const raw = el.getAttribute("style") || "";
                const match = raw.match(/(?:^|;)\s*display\s*:\s*([^;]+)/i);
                return match ? match[1].trim().toLowerCase() : null;
            }

            document.querySelectorAll("*").forEach(el => {
                const display = getInlineDisplay(el);
                if (display === "block" || display === "none") {
                    found.push({
                        id: el.id || "",
                        class: typeof el.className === "string" ? el.className : "",
                        selector: getSelector(el),
                        display,
                        type: display === "none" ? "hidden" : "visible"
                    });
                }
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

            const typeLabel = el.display ? `${el.type}(${el.display})` : el.type;
            li.append(`[${typeLabel}] ID: `, idSpan, ", Class: ", classSpan, " ");
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
