// content.js - Automatic Story Unlocker & Affiliate Bypass for Find Hidden Elements

(function () {
    "use strict";

    if (window.__storyUnlockerLoaded) return;
    window.__storyUnlockerLoaded = true;

    // 1. Session Storage & Anti-Click-Hijack Setup
    function applyStorageBypass() {
        try {
            // Set 'top' to true to satisfy validRenderPopup() in reader components
            sessionStorage.setItem("top", JSON.stringify(true));

            // Neutralize the 10-minute random click hijacker (Gn.validAccessLink)
            // and prevent qn.init() from resetting 'top' to false
            const advData = {
                time: Date.now() + 315360000000, // ~10 years in the future
                link: ""
            };
            sessionStorage.setItem("adv", JSON.stringify(advData));
        } catch (e) {
            // Storage access might be restricted in some contexts
        }
    }

    // 2. Extract paragraph text from React Fiber
    function extractParagraphFromFiber() {
        try {
            const root = document.getElementById("root");
            if (!root) return null;
            const fiberKey = Object.keys(root).find(k => k.startsWith("__reactFiber"));
            if (!fiberKey) return null;

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
                            return stateObj.paragraph;
                        }
                    }
                    hook = hook.next;
                }

                if (cur.child) queue.push(cur.child);
                if (cur.sibling) queue.push(cur.sibling);
            }
        } catch (e) {}
        return null;
    }

    // 3. Directly fetch chapter data from API as fallback
    async function fetchChapterParagraph() {
        try {
            const path = window.location.pathname;
            const match = path.match(/\/([^/]+)\/chuong-(\d+)/);
            if (!match) return null;

            const [, slug, chapterNum] = match;
            const token = localStorage.getItem("59d7d5eeb291f4e5");
            const headers = token ? {"Request-Token": token} : {};
            const res = await fetch(`/api/public/v2/${slug}/${chapterNum}`, {headers});
            if (res.ok) {
                const json = await res.json();
                return json?.chapter?.paragraph || null;
            }
        } catch (e) {}
        return null;
    }

    // 4. Clean transparent overlays and restore text selection
    function restoreTextSelection() {
        // Unblock select-none
        document.querySelectorAll(".select-none").forEach(el => {
            el.classList.remove("select-none");
            el.style.userSelect = "text";
            el.style.webkitUserSelect = "text";
        });

        // Remove transparent overlay covering the text
        document.querySelectorAll(".read_str_content .absolute.inset-0, .read_str_content div.bg-transparent").forEach(el => {
            el.remove();
        });

        // Ensure reader container allows selection and clicks
        document.querySelectorAll(".read_str_content").forEach(el => {
            el.style.userSelect = "text";
            el.style.webkitUserSelect = "text";
            el.style.pointerEvents = "auto";
        });
    }

    // 5. Remove lock containers and inject paragraphs if React failed to render
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

    // 6. Core Unlock Execution
    async function unlockStory() {
        applyStorageBypass();

        let unlocked = false;

        // Check if "Mở lại popup" button exists (user had clicked red X)
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

        // Find affiliate / unlock link
        const links = Array.from(document.querySelectorAll('a[href*="shopee"], a[href*="lazada"], a[href*="s.shopee.vn"]')).concat(
            Array.from(document.querySelectorAll("a")).filter(a => {
                const parent = a.closest("div");
                return parent && parent.innerText && parent.innerText.includes("Mời bạn CLICK vào liên kết");
            })
        );

        for (const link of links) {
            // Trigger React onClick directly if available
            const propsKey = Object.keys(link).find(k => k.startsWith("__reactProps"));
            if (propsKey && typeof link[propsKey]?.onClick === "function") {
                try {
                    link[propsKey].onClick({
                        preventDefault() {},
                        stopPropagation() {}
                    });
                    unlocked = true;
                } catch (e) {}
            }

            // Dispatch click event with preventDefault to prevent opening tab
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
                unlocked = true;
            } catch (e) {
            } finally {
                setTimeout(() => {
                    if (window.open !== origOpen) window.open = origOpen;
                }, 150);
            }
        }

        // Check if .read_str_content has paragraphs
        const content = document.querySelector(".read_str_content");
        const hasParagraphs = content && content.querySelectorAll("p").length > 2;

        if (hasParagraphs) {
            restoreTextSelection();
            removeLockContainers();
            return true;
        }

        // Fallback: React Fiber extraction
        const fiberParagraph = extractParagraphFromFiber();
        if (fiberParagraph) {
            return injectParagraphs(fiberParagraph);
        }

        // Fallback: API fetch
        const apiParagraph = await fetchChapterParagraph();
        if (apiParagraph) {
            return injectParagraphs(apiParagraph);
        }

        return unlocked;
    }

    // Execute immediately
    applyStorageBypass();
    unlockStory();

    // Periodic check on load to handle initial React render timing
    let checkCount = 0;
    const timer = setInterval(() => {
        checkCount++;
        applyStorageBypass();
        unlockStory();
        if (checkCount >= 10) clearInterval(timer);
    }, 500);

    // Watch for DOM changes (SPA chapter navigation)
    const observer = new MutationObserver(() => {
        applyStorageBypass();
        const lockExists = document.querySelector('a[href*="shopee"], a[href*="lazada"]') ||
            Array.from(document.querySelectorAll("h3, span")).some(el =>
                el.textContent && (
                    el.textContent.includes("mở khóa toàn bộ chương truyện") ||
                    el.textContent.includes("Chương đã bị khóa")
                )
            );

        if (lockExists) {
            unlockStory();
        }
        restoreTextSelection();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // Listen for SPA navigation events
    window.addEventListener("popstate", () => {
        applyStorageBypass();
        setTimeout(unlockStory, 200);
    });

    // Expose on window for manual extension invocation
    window.__unlockStoryContent = unlockStory;
})();
