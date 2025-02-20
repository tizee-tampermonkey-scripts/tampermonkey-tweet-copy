// ==UserScript==
// @name         X Tweet Copy
// @namespace    https://github.com/tizee/tempermonkey-tweet-copy
// @version      1.1
// @description  Adds a "Copy" button to each tweet that copies the tweet text along with its URL and shows a check mark animation upon success.
// @author       tizee
// @downloadURL  https://raw.githubusercontent.com/tizee/tempermonkey-tweet-copy/main/user.js
// @updateURL    https://raw.githubusercontent.com/tizee/tempermonkey-tweet-copy/main/user.js
// @match        https://x.com/*
// @grant        GM_addStyle
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // Define SVG constants for the copy icon and the check mark.
    const ORIGINAL_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><g><path d="M19.5 2C20.88 2 22 3.12 22 4.5v11c0 1.21-.86 2.22-2 2.45V4.5c0-.28-.22-.5-.5-.5H6.05c.23-1.14 1.24-2 2.45-2h11zm-4 4C16.88 6 18 7.12 18 8.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C3.12 22 2 20.88 2 19.5v-11C2 7.12 3.12 6 4.5 6h11zM4 19.5c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5v-11c0-.28-.22-.5-.5-.5h-11c-.28 0-.5.22-.5.5v11z"></path></g></svg>`;
    const CHECKMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z"></path>
    </svg>`;

    // Inject CSS styles for the copy button and check mark animation using GM_addStyle.
    GM_addStyle(`
        .tm-copy-button {
            cursor: pointer;
            color: rgb(113, 118, 123);
            font-size: 14px;
            background: transparent;
            border: none;
            padding: 4px;
            margin-left: 8px;
        }
        .tm-copy-button svg {
            fill: currentcolor;
            width: 1.5em;
            height: 1.5em;
            transition: transform 0.3s ease;
        }
        .tm-copy-button:hover svg {
            color: rgb(29, 155, 240);
        }
        /* Animation for the check mark */
        .tm-copy-checkmark {
            animation: checkmark-pop 0.5s ease-in-out;
        }
        @keyframes checkmark-pop {
            0% { transform: scale(0.8); opacity: 0.5; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
        }
    `);

    /**
     * Finds the tweet container (article element with data-testid="tweet")
     * for the given element.
     * @param {HTMLElement} element - The element to search from.
     * @returns {HTMLElement|null} The tweet container or null if not found.
     */
    function findTweetContainer(element) {
        return element.closest('article[data-testid="tweet"]');
    }

    /**
     * Creates and appends a copy button to the button group element.
     * The button, when clicked, copies the tweet text and tweet URL.
     * @param {HTMLElement} groupEl - The container for tweet action buttons.
     */
    function addCopyButtonToGroup(groupEl) {
        if (!groupEl) return;

        // Retrieve the tweet container for this group.
        const tweetContainer = findTweetContainer(groupEl);
        if (!tweetContainer) return;

        // Avoid adding duplicate copy buttons.
        if (groupEl.querySelector('.tm-copy-button')) return;

        // Create the copy button.
        const copyBtn = document.createElement('button');
        copyBtn.className = 'tm-copy-button';
        copyBtn.innerHTML = ORIGINAL_SVG;

        copyBtn.addEventListener('click', (e) => {
            // Prevent event propagation.
            e.stopPropagation();

            // Extract tweet text from elements with data-testid="tweetText".
            const textElements = tweetContainer.querySelectorAll('[data-testid="tweetText"]');
            const tweetText = Array.from(textElements)
                .map(el => el.innerText)
                .join('\n');

            // Attempt to retrieve the tweet URL.
            let tweetUrl = '';
            const linkEl = tweetContainer.querySelector('a[href*="/status/"]');
            if (linkEl && linkEl.href) {
                tweetUrl = linkEl.href;
            }

            // Append the tweet URL to the copied content.
            const copyContent = `${tweetText}\n\nTweet URL: ${tweetUrl}`;
            navigator.clipboard.writeText(copyContent)
                .then(() => {
                    // Show check mark animation on successful copy.
                    copyBtn.innerHTML = CHECKMARK_SVG;
                    copyBtn.classList.add('tm-copy-checkmark');
                    setTimeout(() => {
                        copyBtn.innerHTML = ORIGINAL_SVG;
                        copyBtn.classList.remove('tm-copy-checkmark');
                    }, 1500);
                    console.log('Tweet text copied successfully.');
                })
                .catch(err => console.error('Failed to copy tweet text:', err));
        });

        // Append the button to the action group.
        groupEl.appendChild(copyBtn);
    }

    /**
     * Process all existing button group containers on the page.
     */
    function processExistingGroups() {
        const groups = document.querySelectorAll('div[role="group"]');
        groups.forEach(groupEl => addCopyButtonToGroup(groupEl));
    }

    /**
     * MutationObserver callback to handle dynamically added nodes.
     * @param {MutationRecord[]} mutations - The list of mutations observed.
     */
    function handleMutations(mutations) {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;

                // Gather all elements that match the group selector.
                let groupEls = node.querySelectorAll('div[role="group"]');
                // If the node itself is a group element, include it as well.
                if (node.matches && node.matches('div[role="group"]')) {
                    groupEls = [node, ...groupEls];
                }
                groupEls.forEach(el => addCopyButtonToGroup(el));
            });
        });
    }

    // Initialize MutationObserver to monitor dynamic content changes.
    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true, subtree: true });

    // Process groups present on page load.
    processExistingGroups();
})();
