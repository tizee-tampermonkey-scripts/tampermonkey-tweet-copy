// ==UserScript==
// @name         X Tweet Copy
// @namespace    https://github.com/tizee-tampermonkey-scripts/tampermonkey-tweet-copy
// @version      1.2.5
// @description  Adds a "Copy" button to each tweet and article that copies the content along with its URL and shows a check mark animation upon success, preserving link URLs and styling. Quoted tweets are labeled separately instead of being merged with the main tweet.
// @author       tizee
// @icon         https://www.google.com/s2/favicons?sz=64&domain=x.com
// @downloadURL  https://raw.githubusercontent.com/tizee-tampermonkey-scripts/tampermonkey-tweet-copy/refs/heads/main/user.js
// @updateURL    https://raw.githubusercontent.com/tizee-tampermonkey-scripts/tampermonkey-tweet-copy/refs/heads/main/user.js
// @match        https://x.com/*
// @grant        GM_addStyle
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // Define SVG constants for the copy icon and the check mark.
    const ORIGINAL_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><g><path d="M19.5 2C20.88 2 22 3.12 22 4.5v11c0 1.21-.86 2.22-2 2.45V4.5c0-.28-.22-.5-.5-.5H6.05c.23-1.14 1.24-2 2.45-2h11zm-4 4C16.88 6 18 7.12 18 8.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C3.12 22 2 20.88 2 19.5v-11C2 7.12 3.12 6 4.5 6h11zM4 19.5c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5v-11c0-.28-.22-.5-.5-.5h-11c-.28 0-.5.22-.5.5v11z"></path></g></svg>`;
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
     * Checks if the tweet container is actually a long article.
     * @param {HTMLElement} container - The tweet/article container.
     * @returns {boolean} True if it's a long article.
     */
    function isArticle(container) {
        if (!container) return false;
        // Must have both title and content elements
        const hasTitle = container.querySelector('[data-testid="twitter-article-title"]') !== null;
        const hasContent = container.querySelector('[data-testid="longformRichTextComponent"] > [data-contents="true"]') !== null;
        return hasTitle && hasContent;
    }

    /**
     * Finds the quoted tweet card inside a tweet container.
     * X renders a quoted tweet as a clickable card (div[role="link"]) nested
     * inside the main article, containing its own author (User-Name) and text.
     * @param {HTMLElement} container - The tweet container.
     * @returns {HTMLElement|null} The quoted tweet card or null if none.
     */
    function findQuotedTweetCard(container) {
        const candidates = container.querySelectorAll('div[role="link"]');
        for (const el of candidates) {
            // Discriminate quote cards from media/link-preview cards by the
            // presence of nested tweet author/text markers.
            if (el.querySelector('[data-testid="tweetText"], [data-testid="User-Name"]')) {
                return el;
            }
        }
        return null;
    }

    /**
     * Extracts the @handle from a User-Name element's text.
     * @param {HTMLElement|null} userNameEl - The User-Name element.
     * @returns {string} The @handle (e.g. "@hosseeb") or empty string.
     */
    function extractHandle(userNameEl) {
        if (!userNameEl) return '';
        const match = (userNameEl.innerText || '').match(/@[A-Za-z0-9_]+/);
        return match ? match[0] : '';
    }

    /**
     * Resolves the URL an anchor points to. External links on X use t.co
     * redirects as href, but the full destination URL is kept in the anchor's
     * text (partly in hidden spans, with a trailing ellipsis).
     * @param {HTMLAnchorElement} a - The anchor element.
     * @returns {string} The best available URL.
     */
    function resolveAnchorUrl(a) {
        if (a.hostname === 't.co') {
            const text = a.textContent.trim().replace(/…$/, '');
            if (/^https?:\/\//.test(text)) return text;
        }
        return a.href;
    }

    /**
     * Finds the link-preview card URL of the main tweet. X hides a trailing
     * URL from the tweet text when it is rendered as a card, so the link only
     * exists in the card.
     * @param {HTMLElement} container - The tweet container.
     * @param {HTMLElement|null} quoteCard - The quoted tweet card to exclude.
     * @returns {string} The card URL (usually t.co) or empty string.
     */
    function findCardUrl(container, quoteCard) {
        const anchors = container.querySelectorAll('[data-testid="card.wrapper"] a[href]');
        for (const a of anchors) {
            if (!quoteCard || !quoteCard.contains(a)) return a.href;
        }
        return '';
    }

    /**
     * Clones tweetText elements and rewrites anchors to their full URLs,
     * returning both HTML and plain-text representations.
     * @param {HTMLElement[]} elements - tweetText elements to process.
     * @returns {{html: string, text: string}[]}
     */
    function processTextElements(elements) {
        return elements.map(el => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('a').forEach(a => {
                if (a.href) a.textContent = resolveAnchorUrl(a);
            });
            return { html: clone.innerHTML, text: clone.innerText };
        });
    }

    /**
     * Creates and appends a copy button to the button group element.
     * The button, when clicked, copies the tweet content with styling and tweet URL.
     * @param {HTMLElement} groupEl - The container for tweet action buttons.
     */
    function addCopyButtonToGroup(groupEl) {
        if (!groupEl) return;

        // Retrieve the tweet container for this group.
        const tweetContainer = findTweetContainer(groupEl);
        if (!tweetContainer) return;

        // Check if it's a long article
        const isLongArticle = isArticle(tweetContainer);

        // Avoid adding duplicate copy buttons.
        if (groupEl.querySelector('.tm-copy-button')) return;

        // Create the copy button.
        const copyBtn = document.createElement('button');
        copyBtn.className = 'tm-copy-button';
        copyBtn.innerHTML = ORIGINAL_SVG;

        copyBtn.addEventListener('click', (e) => {
            // Prevent event propagation.
            e.stopPropagation();

            // Debug: log container info
            console.debug('[Tweet Copy] isLongArticle:', isLongArticle);
            console.debug('[Tweet Copy] tweetContainer:', tweetContainer);

            // Handle article content
            if (isLongArticle) {
                // Extract title
                const titleEl = tweetContainer.querySelector('[data-testid="twitter-article-title"]');
                const title = titleEl ? titleEl.innerText : '';
                console.debug('[Tweet Copy] titleEl:', titleEl, 'title:', title);

                // Extract content - traverse child elements to preserve formatting
                const contentEl = tweetContainer.querySelector('[data-testid="longformRichTextComponent"] > [data-contents="true"]');
                console.debug('[Tweet Copy] contentEl:', contentEl);

                if (contentEl) {
                    const contentClone = contentEl.cloneNode(true);
                    // Replace each anchor's visible text with its full URL.
                    contentClone.querySelectorAll('a').forEach(a => {
                        if (a.href) {
                            a.textContent = resolveAnchorUrl(a);
                        }
                    });

                    // Get HTML content as-is
                    const contentHTML = contentClone.innerHTML;

                    // Extract text from each child element to preserve structure
                    const paragraphs = [];
                    contentClone.childNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const text = node.innerText.trim();
                            if (text) {
                                paragraphs.push(text);
                            }
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            const text = node.textContent.trim();
                            if (text) {
                                paragraphs.push(text);
                            }
                        }
                    });
                    const contentText = paragraphs.join('\n\n');

                    console.debug('[Tweet Copy] paragraphs:', paragraphs);
                    console.debug('[Tweet Copy] contentText:', contentText);

                    // Get article URL
                    let articleUrl = '';
                    const linkEl = tweetContainer.querySelector('a[href*="/status/"]');
                    if (linkEl && linkEl.href) {
                        articleUrl = linkEl.href;
                    }

                    const copyHTML = `<strong>${title}</strong><br><br><pre><code>${contentHTML}</code></pre><br><br><strong>Article URL:</strong> <a href="${articleUrl}">${articleUrl}</a>`;
                    const copyText = `${title}\n\n\`\`\`\n${contentText}\n\`\`\`\n\nArticle URL: ${articleUrl}`;

                    // Create Blob items for HTML and plain text.
                    const blobHTML = new Blob([copyHTML], { type: 'text/html' });
                    const blobText = new Blob([copyText], { type: 'text/plain' });

                    // Create a ClipboardItem with both formats.
                    const clipboardItem = new ClipboardItem({
                        'text/html': blobHTML,
                        'text/plain': blobText,
                    });

                    navigator.clipboard.write([clipboardItem])
                        .then(() => {
                            copyBtn.innerHTML = CHECKMARK_SVG;
                            copyBtn.classList.add('tm-copy-checkmark');
                            setTimeout(() => {
                                copyBtn.innerHTML = ORIGINAL_SVG;
                                copyBtn.classList.remove('tm-copy-checkmark');
                            }, 1500);
                            console.debug('Article text copied successfully.');
                        })
                        .catch(err => console.error('Failed to copy article text:', err));
                    return;
                }
            }

            // Handle regular tweet content
            // Detect a quoted tweet card so its content can be kept separate
            // from the main tweet instead of being merged together.
            const quoteCard = findQuotedTweetCard(tweetContainer);

            // Split tweetText elements into the main tweet and the quoted tweet.
            const allTextElements = Array.from(tweetContainer.querySelectorAll('[data-testid="tweetText"]'));
            const mainTextElements = allTextElements.filter(el => !quoteCard || !quoteCard.contains(el));
            const quotedTextElements = quoteCard ? allTextElements.filter(el => quoteCard.contains(el)) : [];

            console.debug('[Tweet Copy] main:', mainTextElements.length, 'quoted:', quotedTextElements.length);

            // Process the main tweet content.
            const mainContent = processTextElements(mainTextElements);
            let mainHTML = mainContent.map(obj => obj.html).join('<br><br>');
            let mainText = mainContent.map(obj => obj.text).join('\n\n');

            // Restore the card link that X strips from the tweet text, unless
            // the same link is already present in the text.
            const cardUrl = findCardUrl(tweetContainer, quoteCard);
            const cardInText = mainTextElements.some(el =>
                Array.from(el.querySelectorAll('a')).some(a => a.href === cardUrl));
            if (cardUrl && !cardInText) {
                mainHTML += `<br><br><a href="${cardUrl}">${cardUrl}</a>`;
                mainText += `\n\n${cardUrl}`;
            }

            // Retrieve the main tweet URL. The first status link belongs to the
            // main tweet; quoted cards do not expose a status anchor.
            let tweetUrl = '';
            const linkEl = tweetContainer.querySelector('a[href*="/status/"]');
            if (linkEl && linkEl.href) {
                tweetUrl = linkEl.href;
            }

            // Build the base payload for the main tweet.
            let copyHTML = `<pre><code>${mainHTML}</code></pre>`;
            let copyText = `\`\`\`\n${mainText}\n\`\`\``;

            // Append the quoted tweet as a clearly labeled, separate block.
            if (quoteCard && quotedTextElements.length) {
                const quotedContent = processTextElements(quotedTextElements);
                const quotedHTML = quotedContent.map(obj => obj.html).join('<br><br>');
                const quotedText = quotedContent.map(obj => obj.text).join('\n\n');

                const quotedHandle = extractHandle(quoteCard.querySelector('[data-testid="User-Name"]'));
                const quotedLabel = quotedHandle ? `Quoted tweet from ${quotedHandle}` : 'Quoted tweet';

                // Include the quoted status URL only if X exposes it in the DOM.
                let quotedUrl = '';
                const quotedLink = quoteCard.querySelector('a[href*="/status/"]');
                if (quotedLink && quotedLink.href) {
                    quotedUrl = quotedLink.href;
                }

                copyHTML += `<br><br><strong>${quotedLabel}:</strong><blockquote>${quotedHTML}</blockquote>`;
                copyText += `\n\n${quotedLabel}:\n${quotedText.split('\n').map(line => `> ${line}`).join('\n')}`;

                if (quotedUrl) {
                    copyHTML += `<strong>Quoted URL:</strong> <a href="${quotedUrl}">${quotedUrl}</a>`;
                    copyText += `\n>\n> Quoted URL: ${quotedUrl}`;
                }
            }

            // Append the main tweet URL.
            copyHTML += `<br><br><strong>Tweet URL:</strong> <a href="${tweetUrl}">${tweetUrl}</a>`;
            copyText += `\n\nTweet URL: ${tweetUrl}`;

            // Create Blob items for HTML and plain text.
            const blobHTML = new Blob([copyHTML], { type: 'text/html' });
            const blobText = new Blob([copyText], { type: 'text/plain' });

            // Create a ClipboardItem with both formats.
            const clipboardItem = new ClipboardItem({
                'text/html': blobHTML,
                'text/plain': blobText,
            });

            // Write both formats to the clipboard.
            navigator.clipboard.write([clipboardItem])
                .then(() => {
                    // Show check mark animation on successful copy.
                    copyBtn.innerHTML = CHECKMARK_SVG;
                    copyBtn.classList.add('tm-copy-checkmark');
                    setTimeout(() => {
                        copyBtn.innerHTML = ORIGINAL_SVG;
                        copyBtn.classList.remove('tm-copy-checkmark');
                    }, 1500);
                    console.debug('Tweet text copied successfully.');
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

                // Gather all elements that match the group selector (tweets and articles).
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
