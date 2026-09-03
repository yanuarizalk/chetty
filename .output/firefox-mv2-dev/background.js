var background = (function() {
	//#region node_modules/.pnpm/wxt@0.21.4_rolldown@1.2.6_t_dae9b968505109211a4b829ee72ce2d1/node_modules/wxt/dist/utils/define-background.mjs
	function defineBackground(arg) {
		if (arg == null || typeof arg === "function") return { main: arg };
		return arg;
	}
	//#endregion
	//#region entrypoints/background.ts
	var background_default = defineBackground(() => {
		console.log("[Chetty Background] Service worker initialized.");
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			if (message.type === "CHETTY_GET_TABS") {
				(async () => {
					try {
						const tabs = await chrome.tabs.query({ currentWindow: true });
						const currentTabId = sender.tab?.id;
						sendResponse({ tabs: tabs.filter((t) => t.id && t.id !== currentTabId && t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("about:")).map((t) => ({
							id: t.id,
							title: t.title || "Untitled Tab",
							url: t.url || "",
							favIconUrl: t.favIconUrl
						})) });
					} catch (err) {
						sendResponse({
							tabs: [],
							error: err.message
						});
					}
				})();
				return true;
			}
			if (message.type === "CHETTY_EXTRACT_TAB_CONTEXT") {
				(async () => {
					try {
						const tabId = message.tabId;
						const [result] = await chrome.scripting.executeScript({
							target: { tabId },
							func: () => {
								return {
									title: document.title,
									url: window.location.href,
									text: (document.body.innerText || "").slice(0, 1e4)
								};
							}
						});
						if (result && result.result) {
							const { title, url, text } = result.result;
							sendResponse({ context: {
								type: "other_tab",
								title,
								url,
								content: text,
								summary: `Content extracted from "${title}"`
							} });
						} else sendResponse({
							context: null,
							error: "Could not extract content from tab"
						});
					} catch (err) {
						sendResponse({
							context: null,
							error: err.message
						});
					}
				})();
				return true;
			}
			if (message.type === "CHETTY_BG_NEW_SESSION") {
				(async () => {
					try {
						const [activeTab] = await chrome.tabs.query({
							active: true,
							currentWindow: true
						});
						if (!activeTab || !activeTab.id) {
							sendResponse({
								success: false,
								error: "No active tab found"
							});
							return;
						}
						try {
							sendResponse(await chrome.tabs.sendMessage(activeTab.id, {
								type: "CHETTY_OPEN_NEW_SESSION",
								title: message.title
							}));
						} catch {
							await chrome.scripting.executeScript({
								target: { tabId: activeTab.id },
								files: ["content-scripts/content.js"]
							});
							sendResponse(await chrome.tabs.sendMessage(activeTab.id, {
								type: "CHETTY_OPEN_NEW_SESSION",
								title: message.title
							}));
						}
					} catch (err) {
						sendResponse({
							success: false,
							error: err.message
						});
					}
				})();
				return true;
			}
			if (message.type === "CHETTY_BG_OPEN_SESSION") {
				(async () => {
					try {
						const [activeTab] = await chrome.tabs.query({
							active: true,
							currentWindow: true
						});
						if (!activeTab || !activeTab.id) {
							sendResponse({
								success: false,
								error: "No active tab found"
							});
							return;
						}
						try {
							sendResponse(await chrome.tabs.sendMessage(activeTab.id, {
								type: "CHETTY_OPEN_SESSION",
								sessionId: message.sessionId
							}));
						} catch {
							await chrome.scripting.executeScript({
								target: { tabId: activeTab.id },
								files: ["content-scripts/content.js"]
							});
							sendResponse(await chrome.tabs.sendMessage(activeTab.id, {
								type: "CHETTY_OPEN_SESSION",
								sessionId: message.sessionId
							}));
						}
					} catch (err) {
						sendResponse({
							success: false,
							error: err.message
						});
					}
				})();
				return true;
			}
			return false;
		});
	});
	//#endregion
	//#region node_modules/.pnpm/wxt@0.21.4_rolldown@1.2.6_t_dae9b968505109211a4b829ee72ce2d1/node_modules/wxt/dist/browser.mjs
	/**
	* Contains the `browser` export which you should use to access the extension
	* APIs in your project:
	*
	* ```ts
	* import { browser } from 'wxt/browser';
	*
	* browser.runtime.onInstalled.addListener(() => {
	*   // ...
	* });
	* ```
	*
	* @module wxt/browser
	*/
	var browser = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
	//#endregion
	//#region node_modules/.pnpm/@webext-core+match-patterns@2.0.0/node_modules/@webext-core/match-patterns/dist/index.mjs
	/**
	* Class for parsing and performing operations on match patterns.
	*
	* @example
	*   const pattern = new MatchPattern('*://google.com/*');
	*
	*   pattern.includes('https://google.com'); // true
	*   pattern.includes('http://youtube.com/watch?v=123'); // false
	*/
	var MatchPattern = class MatchPattern {
		static {
			this.PROTOCOLS = [
				"http",
				"https",
				"file",
				"ftp",
				"urn",
				"ws",
				"wss"
			];
		}
		/**
		* Parse a match pattern string. If it is invalid, the constructor will throw an
		* `InvalidMatchPattern` error.
		*
		* @param matchPattern The match pattern to parse.
		*/
		constructor(matchPattern) {
			if (matchPattern === "<all_urls>") {
				this.isAllUrls = true;
				this.protocolMatches = [...MatchPattern.PROTOCOLS];
				this.hostnameMatch = "*";
				this.pathnameMatch = "*";
			} else {
				const groups = /(.*):\/\/(.*?)(\/.*)/.exec(matchPattern);
				if (groups == null) throw new InvalidMatchPattern(matchPattern, "Incorrect format");
				const [_, protocol, hostname, pathname] = groups;
				validateProtocol(matchPattern, protocol);
				validateHostname(matchPattern, hostname);
				this.protocolMatches = protocol === "*" ? ["http", "https"] : [protocol];
				this.hostnameMatch = hostname;
				this.pathnameMatch = pathname;
			}
		}
		/** Check if a URL is included in a pattern. */
		includes(url) {
			const u = typeof url === "string" ? new URL(url) : url instanceof Location ? new URL(url.href) : url;
			if (this.isAllUrls) return !this.isUnknownProtocol(u);
			return !!this.protocolMatches.find((protocol) => {
				if (protocol === "http") return this.isHttpMatch(u);
				if (protocol === "https") return this.isHttpsMatch(u);
				if (protocol === "file") return this.isFileMatch(u);
				if (protocol === "ftp") return this.isFtpMatch(u);
				if (protocol === "urn") return this.isUrnMatch(u);
			});
		}
		isHttpMatch(url) {
			return url.protocol === "http:" && this.isHostPathMatch(url);
		}
		isHttpsMatch(url) {
			return url.protocol === "https:" && this.isHostPathMatch(url);
		}
		isHostPathMatch(url) {
			if (!this.hostnameMatch || !this.pathnameMatch) return false;
			const hostnameMatchRegexs = [this.convertPatternToRegex(this.hostnameMatch), this.convertPatternToRegex(this.hostnameMatch.replace(/^\*\./, ""))];
			const pathnameMatchRegex = this.convertPatternToRegex(this.pathnameMatch);
			return !!hostnameMatchRegexs.find((regex) => regex.test(url.hostname)) && pathnameMatchRegex.test(url.pathname);
		}
		isUnknownProtocol(url) {
			return !this.protocolMatches.includes(url.protocol.slice(0, -1));
		}
		isPathMatch(url) {
			if (!this.pathnameMatch) return false;
			return this.convertPatternToRegex(this.pathnameMatch).test(url.pathname);
		}
		isFileMatch(url) {
			return url.protocol === "file:" && this.isPathMatch(url);
		}
		isFtpMatch(_url) {
			throw Error("Not implemented: ftp:// pattern matching. Open a PR to add support");
		}
		isUrnMatch(_url) {
			throw Error("Not implemented: urn:// pattern matching. Open a PR to add support");
		}
		convertPatternToRegex(pattern) {
			const starsReplaced = this.escapeForRegex(pattern).replace(/\\\*/g, ".*");
			return RegExp(`^${starsReplaced}$`);
		}
		escapeForRegex(string) {
			return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	};
	var InvalidMatchPattern = class extends Error {
		constructor(matchPattern, reason) {
			super(`Invalid match pattern "${matchPattern}": ${reason}`);
		}
	};
	function validateProtocol(matchPattern, protocol) {
		if (!MatchPattern.PROTOCOLS.includes(protocol) && protocol !== "*") throw new InvalidMatchPattern(matchPattern, `${protocol} not a valid protocol (${MatchPattern.PROTOCOLS.join(", ")})`);
	}
	function validateHostname(matchPattern, hostname) {
		if (hostname.includes(":")) throw new InvalidMatchPattern(matchPattern, `Hostname cannot include a port`);
		if (hostname.includes("*") && hostname.length > 1 && !hostname.startsWith("*.")) throw new InvalidMatchPattern(matchPattern, `If using a wildcard (*), it must go at the start of the hostname`);
	}
	//#endregion
	//#region \0virtual:wxt-background-entrypoint?D:/Projects/chetty/entrypoints/background.ts
	function print(method, ...args) {
		if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
		else method("[wxt]", ...args);
	}
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger = {
		debug: (...args) => print(console.debug, ...args),
		log: (...args) => print(console.log, ...args),
		warn: (...args) => print(console.warn, ...args),
		error: (...args) => print(console.error, ...args)
	};
	var ws;
	/** Connect to the websocket and listen for messages. */
	function getDevServerWebSocket() {
		if (ws == null) {
			const serverUrl = "ws://localhost:3000";
			logger.debug("Connecting to dev server @", serverUrl);
			ws = new WebSocket(serverUrl, "vite-hmr");
			ws.addWxtEventListener = ws.addEventListener.bind(ws);
			ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
				type: "custom",
				event,
				payload
			}));
			ws.addEventListener("open", () => {
				logger.debug("Connected to dev server");
			});
			ws.addEventListener("close", () => {
				logger.debug("Disconnected from dev server");
			});
			ws.addEventListener("error", (event) => {
				logger.error("Failed to connect to dev server", event);
			});
			ws.addEventListener("message", (e) => {
				try {
					const message = JSON.parse(e.data);
					if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
				} catch (err) {
					logger.error("Failed to handle message", err);
				}
			});
		}
		return ws;
	}
	function reloadContentScript(payload) {
		if (browser.runtime.getManifest().manifest_version == 2) reloadContentScriptMv2(payload);
		else reloadContentScriptMv3(payload);
	}
	async function reloadContentScriptMv3({ registration, contentScript }) {
		if (registration === "runtime") await reloadRuntimeContentScriptMv3(contentScript);
		else await reloadManifestContentScriptMv3(contentScript);
	}
	async function reloadManifestContentScriptMv3(contentScript) {
		const id = `wxt:${contentScript.js[0]}`;
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const existing = registered.find((cs) => cs.id === id);
		if (existing) {
			logger.debug("Updating content script", existing);
			await browser.scripting.updateContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		} else {
			logger.debug("Registering new content script...");
			await browser.scripting.registerContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		}
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadRuntimeContentScriptMv3(contentScript) {
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const matches = registered.filter((cs) => {
			const hasJs = contentScript.js?.find((js) => cs.js?.includes(js));
			const hasCss = contentScript.css?.find((css) => cs.css?.includes(css));
			return hasJs || hasCss;
		});
		if (matches.length === 0) {
			logger.log("Content script is not registered yet, nothing to reload", contentScript);
			return;
		}
		await browser.scripting.updateContentScripts(matches);
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadTabsForContentScript(contentScript) {
		const allTabs = await browser.tabs.query({});
		const matchPatterns = contentScript.matches.map((match) => new MatchPattern(match));
		const matchingTabs = allTabs.filter((tab) => {
			const url = tab.url;
			if (!url) return false;
			return !!matchPatterns.find((pattern) => pattern.includes(url));
		});
		await Promise.all(matchingTabs.map(async (tab) => {
			try {
				await browser.tabs.reload(tab.id);
			} catch (err) {
				logger.warn("Failed to reload tab:", err);
			}
		}));
	}
	async function reloadContentScriptMv2(_payload) {
		throw Error("TODO: reloadContentScriptMv2");
	}
	try {
		const ws = getDevServerWebSocket();
		ws.addWxtEventListener("wxt:reload-extension", () => {
			browser.runtime.reload();
		});
		ws.addWxtEventListener("wxt:reload-content-script", (event) => {
			reloadContentScript(event.detail);
		});
	} catch (err) {
		logger.error("Failed to setup web socket connection with dev server", err);
	}
	browser.commands.onCommand.addListener((command) => {
		if (command === "wxt:reload-extension") browser.runtime.reload();
	});
	var result;
	try {
		result = background_default.main();
		if (result instanceof Promise) console.warn("The background's main() function return a promise, but it must be synchronous");
	} catch (err) {
		logger.error("The background crashed on startup!");
		throw err;
	}
	//#endregion
	return result;
})();

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiXSwic291cmNlcyI6WyIuLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vd3h0QDAuMjEuNF9yb2xsZG93bkAxLjIuNl90X2RhZTliOTY4NTA1MTA5MjExYTRiODI5ZWU3MmNlMmQxL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9kZWZpbmUtYmFja2dyb3VuZC5tanMiLCIuLi8uLi9lbnRyeXBvaW50cy9iYWNrZ3JvdW5kLnRzIiwiLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0B3eHQtZGV2K2Jyb3dzZXJAMC4yLjgvbm9kZV9tb2R1bGVzL0B3eHQtZGV2L2Jyb3dzZXIvc3JjL2luZGV4Lm1qcyIsIi4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS93eHRAMC4yMS40X3JvbGxkb3duQDEuMi42X3RfZGFlOWI5Njg1MDUxMDkyMTFhNGI4MjllZTcyY2UyZDEvbm9kZV9tb2R1bGVzL3d4dC9kaXN0L2Jyb3dzZXIubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0B3ZWJleHQtY29yZSttYXRjaC1wYXR0ZXJuc0AyLjAuMC9ub2RlX21vZHVsZXMvQHdlYmV4dC1jb3JlL21hdGNoLXBhdHRlcm5zL2Rpc3QvaW5kZXgubWpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vI3JlZ2lvbiBzcmMvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQudHNcbmZ1bmN0aW9uIGRlZmluZUJhY2tncm91bmQoYXJnKSB7XG5cdGlmIChhcmcgPT0gbnVsbCB8fCB0eXBlb2YgYXJnID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiB7IG1haW46IGFyZyB9O1xuXHRyZXR1cm4gYXJnO1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBkZWZpbmVCYWNrZ3JvdW5kIH07XG4iLCJpbXBvcnQgeyBkZWZpbmVCYWNrZ3JvdW5kIH0gZnJvbSAnd3h0L3V0aWxzL2RlZmluZS1iYWNrZ3JvdW5kJztcbmltcG9ydCB0eXBlIHsgQ29udGV4dFNuaXBwZXQsIFRhYkNvbnRleHRTdW1tYXJ5IH0gZnJvbSAnLi4vc3JjL3R5cGVzL3Nlc3Npb24nO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVCYWNrZ3JvdW5kKCgpID0+IHtcbiAgY29uc29sZS5sb2coJ1tDaGV0dHkgQmFja2dyb3VuZF0gU2VydmljZSB3b3JrZXIgaW5pdGlhbGl6ZWQuJyk7XG5cbiAgLy8gSGFuZGxlIHJ1bnRpbWUgbWVzc2FnZXNcbiAgY2hyb21lLnJ1bnRpbWUub25NZXNzYWdlLmFkZExpc3RlbmVyKChtZXNzYWdlLCBzZW5kZXIsIHNlbmRSZXNwb25zZSkgPT4ge1xuICAgIC8vIDEuIEdldCBvcGVuIHRhYnMgaW4gY3VycmVudCB3aW5kb3cgKGZvciBjcm9zcy10YWIgY29udGV4dClcbiAgICBpZiAobWVzc2FnZS50eXBlID09PSAnQ0hFVFRZX0dFVF9UQUJTJykge1xuICAgICAgKGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB0YWJzID0gYXdhaXQgY2hyb21lLnRhYnMucXVlcnkoeyBjdXJyZW50V2luZG93OiB0cnVlIH0pO1xuICAgICAgICAgIGNvbnN0IGN1cnJlbnRUYWJJZCA9IHNlbmRlci50YWI/LmlkO1xuICAgICAgICAgIGNvbnN0IHN1bW1hcmllczogVGFiQ29udGV4dFN1bW1hcnlbXSA9IHRhYnNcbiAgICAgICAgICAgIC5maWx0ZXIoKHQpID0+IHQuaWQgJiYgdC5pZCAhPT0gY3VycmVudFRhYklkICYmIHQudXJsICYmICF0LnVybC5zdGFydHNXaXRoKCdjaHJvbWU6Ly8nKSAmJiAhdC51cmwuc3RhcnRzV2l0aCgnYWJvdXQ6JykpXG4gICAgICAgICAgICAubWFwKCh0KSA9PiAoe1xuICAgICAgICAgICAgICBpZDogdC5pZCEsXG4gICAgICAgICAgICAgIHRpdGxlOiB0LnRpdGxlIHx8ICdVbnRpdGxlZCBUYWInLFxuICAgICAgICAgICAgICB1cmw6IHQudXJsIHx8ICcnLFxuICAgICAgICAgICAgICBmYXZJY29uVXJsOiB0LmZhdkljb25VcmwsXG4gICAgICAgICAgICB9KSk7XG5cbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyB0YWJzOiBzdW1tYXJpZXMgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHRhYnM6IFtdLCBlcnJvcjogKGVyciBhcyBFcnJvcikubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgfSkoKTtcbiAgICAgIHJldHVybiB0cnVlOyAvLyBLZWVwIGNoYW5uZWwgb3BlbiBmb3IgYXN5bmMgcmVzcG9uc2VcbiAgICB9XG5cbiAgICAvLyAyLiBFeHRyYWN0IGNvbnRleHQgZnJvbSBhIHNwZWNpZmljIHJlbW90ZSB0YWJcbiAgICBpZiAobWVzc2FnZS50eXBlID09PSAnQ0hFVFRZX0VYVFJBQ1RfVEFCX0NPTlRFWFQnKSB7XG4gICAgICAoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHRhYklkID0gbWVzc2FnZS50YWJJZCBhcyBudW1iZXI7XG4gICAgICAgICAgY29uc3QgW3Jlc3VsdF0gPSBhd2FpdCBjaHJvbWUuc2NyaXB0aW5nLmV4ZWN1dGVTY3JpcHQoe1xuICAgICAgICAgICAgdGFyZ2V0OiB7IHRhYklkIH0sXG4gICAgICAgICAgICBmdW5jOiAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQudGl0bGU7XG4gICAgICAgICAgICAgIGNvbnN0IHVybCA9IHdpbmRvdy5sb2NhdGlvbi5ocmVmO1xuICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gKGRvY3VtZW50LmJvZHkuaW5uZXJUZXh0IHx8ICcnKS5zbGljZSgwLCAxMDAwMCk7XG4gICAgICAgICAgICAgIHJldHVybiB7IHRpdGxlLCB1cmwsIHRleHQgfTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICBpZiAocmVzdWx0ICYmIHJlc3VsdC5yZXN1bHQpIHtcbiAgICAgICAgICAgIGNvbnN0IHsgdGl0bGUsIHVybCwgdGV4dCB9ID0gcmVzdWx0LnJlc3VsdDtcbiAgICAgICAgICAgIGNvbnN0IHNuaXBwZXQ6IENvbnRleHRTbmlwcGV0ID0ge1xuICAgICAgICAgICAgICB0eXBlOiAnb3RoZXJfdGFiJyxcbiAgICAgICAgICAgICAgdGl0bGUsXG4gICAgICAgICAgICAgIHVybCxcbiAgICAgICAgICAgICAgY29udGVudDogdGV4dCxcbiAgICAgICAgICAgICAgc3VtbWFyeTogYENvbnRlbnQgZXh0cmFjdGVkIGZyb20gXCIke3RpdGxlfVwiYCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBjb250ZXh0OiBzbmlwcGV0IH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBjb250ZXh0OiBudWxsLCBlcnJvcjogJ0NvdWxkIG5vdCBleHRyYWN0IGNvbnRlbnQgZnJvbSB0YWInIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgY29udGV4dDogbnVsbCwgZXJyb3I6IChlcnIgYXMgRXJyb3IpLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyAzLiBPcGVuIG5ldyBzZXNzaW9uIG9uIGFjdGl2ZSB0YWJcbiAgICBpZiAobWVzc2FnZS50eXBlID09PSAnQ0hFVFRZX0JHX05FV19TRVNTSU9OJykge1xuICAgICAgKGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBbYWN0aXZlVGFiXSA9IGF3YWl0IGNocm9tZS50YWJzLnF1ZXJ5KHsgYWN0aXZlOiB0cnVlLCBjdXJyZW50V2luZG93OiB0cnVlIH0pO1xuICAgICAgICAgIGlmICghYWN0aXZlVGFiIHx8ICFhY3RpdmVUYWIuaWQpIHtcbiAgICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ05vIGFjdGl2ZSB0YWIgZm91bmQnIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEVuc3VyZSBjb250ZW50IHNjcmlwdCBpcyBpbmplY3RlZCBvciBwaW5nIHRhYlxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgY2hyb21lLnRhYnMuc2VuZE1lc3NhZ2UoYWN0aXZlVGFiLmlkLCB7XG4gICAgICAgICAgICAgIHR5cGU6ICdDSEVUVFlfT1BFTl9ORVdfU0VTU0lPTicsXG4gICAgICAgICAgICAgIHRpdGxlOiBtZXNzYWdlLnRpdGxlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UocmVzcCk7XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAvLyBJZiBjb250ZW50IHNjcmlwdCB3YXMgbm90IHJlYWR5LCBpbmplY3QgaXQgZHluYW1pY2FsbHlcbiAgICAgICAgICAgIGF3YWl0IGNocm9tZS5zY3JpcHRpbmcuZXhlY3V0ZVNjcmlwdCh7XG4gICAgICAgICAgICAgIHRhcmdldDogeyB0YWJJZDogYWN0aXZlVGFiLmlkIH0sXG4gICAgICAgICAgICAgIGZpbGVzOiBbJ2NvbnRlbnQtc2NyaXB0cy9jb250ZW50LmpzJ10sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBjaHJvbWUudGFicy5zZW5kTWVzc2FnZShhY3RpdmVUYWIuaWQsIHtcbiAgICAgICAgICAgICAgdHlwZTogJ0NIRVRUWV9PUEVOX05FV19TRVNTSU9OJyxcbiAgICAgICAgICAgICAgdGl0bGU6IG1lc3NhZ2UudGl0bGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHNlbmRSZXNwb25zZShyZXNwKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogKGVyciBhcyBFcnJvcikubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgfSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIDQuIE9wZW4gc3BlY2lmaWMgZXhpc3Rpbmcgc2Vzc2lvbiBvbiBhY3RpdmUgdGFiXG4gICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gJ0NIRVRUWV9CR19PUEVOX1NFU1NJT04nKSB7XG4gICAgICAoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IFthY3RpdmVUYWJdID0gYXdhaXQgY2hyb21lLnRhYnMucXVlcnkoeyBhY3RpdmU6IHRydWUsIGN1cnJlbnRXaW5kb3c6IHRydWUgfSk7XG4gICAgICAgICAgaWYgKCFhY3RpdmVUYWIgfHwgIWFjdGl2ZVRhYi5pZCkge1xuICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnTm8gYWN0aXZlIHRhYiBmb3VuZCcgfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBjaHJvbWUudGFicy5zZW5kTWVzc2FnZShhY3RpdmVUYWIuaWQsIHtcbiAgICAgICAgICAgICAgdHlwZTogJ0NIRVRUWV9PUEVOX1NFU1NJT04nLFxuICAgICAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2Uuc2Vzc2lvbklkLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UocmVzcCk7XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICBhd2FpdCBjaHJvbWUuc2NyaXB0aW5nLmV4ZWN1dGVTY3JpcHQoe1xuICAgICAgICAgICAgICB0YXJnZXQ6IHsgdGFiSWQ6IGFjdGl2ZVRhYi5pZCB9LFxuICAgICAgICAgICAgICBmaWxlczogWydjb250ZW50LXNjcmlwdHMvY29udGVudC5qcyddLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgY2hyb21lLnRhYnMuc2VuZE1lc3NhZ2UoYWN0aXZlVGFiLmlkLCB7XG4gICAgICAgICAgICAgIHR5cGU6ICdDSEVUVFlfT1BFTl9TRVNTSU9OJyxcbiAgICAgICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlLnNlc3Npb25JZCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHJlc3ApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAoZXJyIGFzIEVycm9yKS5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICB9KSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9KTtcbn0pO1xuIiwiLy8gI3JlZ2lvbiBzbmlwcGV0XG5leHBvcnQgY29uc3QgYnJvd3NlciA9IGdsb2JhbFRoaXMuYnJvd3Nlcj8ucnVudGltZT8uaWRcbiAgPyBnbG9iYWxUaGlzLmJyb3dzZXJcbiAgOiBnbG9iYWxUaGlzLmNocm9tZTtcbi8vICNlbmRyZWdpb24gc25pcHBldFxuIiwiaW1wb3J0IHsgYnJvd3NlciBhcyBicm93c2VyJDEgfSBmcm9tIFwiQHd4dC1kZXYvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy9icm93c2VyLnRzXG4vKipcbiogQ29udGFpbnMgdGhlIGBicm93c2VyYCBleHBvcnQgd2hpY2ggeW91IHNob3VsZCB1c2UgdG8gYWNjZXNzIHRoZSBleHRlbnNpb25cbiogQVBJcyBpbiB5b3VyIHByb2plY3Q6XG4qXG4qIGBgYHRzXG4qIGltcG9ydCB7IGJyb3dzZXIgfSBmcm9tICd3eHQvYnJvd3Nlcic7XG4qXG4qIGJyb3dzZXIucnVudGltZS5vbkluc3RhbGxlZC5hZGRMaXN0ZW5lcigoKSA9PiB7XG4qICAgLy8gLi4uXG4qIH0pO1xuKiBgYGBcbipcbiogQG1vZHVsZSB3eHQvYnJvd3NlclxuKi9cbmNvbnN0IGJyb3dzZXIgPSBicm93c2VyJDE7XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGJyb3dzZXIgfTtcbiIsIi8vI3JlZ2lvbiBzcmMvaW5kZXgudHNcbi8qKlxuKiBDbGFzcyBmb3IgcGFyc2luZyBhbmQgcGVyZm9ybWluZyBvcGVyYXRpb25zIG9uIG1hdGNoIHBhdHRlcm5zLlxuKlxuKiBAZXhhbXBsZVxuKiAgIGNvbnN0IHBhdHRlcm4gPSBuZXcgTWF0Y2hQYXR0ZXJuKCcqOi8vZ29vZ2xlLmNvbS8qJyk7XG4qXG4qICAgcGF0dGVybi5pbmNsdWRlcygnaHR0cHM6Ly9nb29nbGUuY29tJyk7IC8vIHRydWVcbiogICBwYXR0ZXJuLmluY2x1ZGVzKCdodHRwOi8veW91dHViZS5jb20vd2F0Y2g/dj0xMjMnKTsgLy8gZmFsc2VcbiovXG52YXIgTWF0Y2hQYXR0ZXJuID0gY2xhc3MgTWF0Y2hQYXR0ZXJuIHtcblx0c3RhdGljIHtcblx0XHR0aGlzLlBST1RPQ09MUyA9IFtcblx0XHRcdFwiaHR0cFwiLFxuXHRcdFx0XCJodHRwc1wiLFxuXHRcdFx0XCJmaWxlXCIsXG5cdFx0XHRcImZ0cFwiLFxuXHRcdFx0XCJ1cm5cIixcblx0XHRcdFwid3NcIixcblx0XHRcdFwid3NzXCJcblx0XHRdO1xuXHR9XG5cdC8qKlxuXHQqIFBhcnNlIGEgbWF0Y2ggcGF0dGVybiBzdHJpbmcuIElmIGl0IGlzIGludmFsaWQsIHRoZSBjb25zdHJ1Y3RvciB3aWxsIHRocm93IGFuXG5cdCogYEludmFsaWRNYXRjaFBhdHRlcm5gIGVycm9yLlxuXHQqXG5cdCogQHBhcmFtIG1hdGNoUGF0dGVybiBUaGUgbWF0Y2ggcGF0dGVybiB0byBwYXJzZS5cblx0Ki9cblx0Y29uc3RydWN0b3IobWF0Y2hQYXR0ZXJuKSB7XG5cdFx0aWYgKG1hdGNoUGF0dGVybiA9PT0gXCI8YWxsX3VybHM+XCIpIHtcblx0XHRcdHRoaXMuaXNBbGxVcmxzID0gdHJ1ZTtcblx0XHRcdHRoaXMucHJvdG9jb2xNYXRjaGVzID0gWy4uLk1hdGNoUGF0dGVybi5QUk9UT0NPTFNdO1xuXHRcdFx0dGhpcy5ob3N0bmFtZU1hdGNoID0gXCIqXCI7XG5cdFx0XHR0aGlzLnBhdGhuYW1lTWF0Y2ggPSBcIipcIjtcblx0XHR9IGVsc2Uge1xuXHRcdFx0Y29uc3QgZ3JvdXBzID0gLyguKik6XFwvXFwvKC4qPykoXFwvLiopLy5leGVjKG1hdGNoUGF0dGVybik7XG5cdFx0XHRpZiAoZ3JvdXBzID09IG51bGwpIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgXCJJbmNvcnJlY3QgZm9ybWF0XCIpO1xuXHRcdFx0Y29uc3QgW18sIHByb3RvY29sLCBob3N0bmFtZSwgcGF0aG5hbWVdID0gZ3JvdXBzO1xuXHRcdFx0dmFsaWRhdGVQcm90b2NvbChtYXRjaFBhdHRlcm4sIHByb3RvY29sKTtcblx0XHRcdHZhbGlkYXRlSG9zdG5hbWUobWF0Y2hQYXR0ZXJuLCBob3N0bmFtZSk7XG5cdFx0XHR0aGlzLnByb3RvY29sTWF0Y2hlcyA9IHByb3RvY29sID09PSBcIipcIiA/IFtcImh0dHBcIiwgXCJodHRwc1wiXSA6IFtwcm90b2NvbF07XG5cdFx0XHR0aGlzLmhvc3RuYW1lTWF0Y2ggPSBob3N0bmFtZTtcblx0XHRcdHRoaXMucGF0aG5hbWVNYXRjaCA9IHBhdGhuYW1lO1xuXHRcdH1cblx0fVxuXHQvKiogQ2hlY2sgaWYgYSBVUkwgaXMgaW5jbHVkZWQgaW4gYSBwYXR0ZXJuLiAqL1xuXHRpbmNsdWRlcyh1cmwpIHtcblx0XHRjb25zdCB1ID0gdHlwZW9mIHVybCA9PT0gXCJzdHJpbmdcIiA/IG5ldyBVUkwodXJsKSA6IHVybCBpbnN0YW5jZW9mIExvY2F0aW9uID8gbmV3IFVSTCh1cmwuaHJlZikgOiB1cmw7XG5cdFx0aWYgKHRoaXMuaXNBbGxVcmxzKSByZXR1cm4gIXRoaXMuaXNVbmtub3duUHJvdG9jb2wodSk7XG5cdFx0cmV0dXJuICEhdGhpcy5wcm90b2NvbE1hdGNoZXMuZmluZCgocHJvdG9jb2wpID0+IHtcblx0XHRcdGlmIChwcm90b2NvbCA9PT0gXCJodHRwXCIpIHJldHVybiB0aGlzLmlzSHR0cE1hdGNoKHUpO1xuXHRcdFx0aWYgKHByb3RvY29sID09PSBcImh0dHBzXCIpIHJldHVybiB0aGlzLmlzSHR0cHNNYXRjaCh1KTtcblx0XHRcdGlmIChwcm90b2NvbCA9PT0gXCJmaWxlXCIpIHJldHVybiB0aGlzLmlzRmlsZU1hdGNoKHUpO1xuXHRcdFx0aWYgKHByb3RvY29sID09PSBcImZ0cFwiKSByZXR1cm4gdGhpcy5pc0Z0cE1hdGNoKHUpO1xuXHRcdFx0aWYgKHByb3RvY29sID09PSBcInVyblwiKSByZXR1cm4gdGhpcy5pc1Vybk1hdGNoKHUpO1xuXHRcdH0pO1xuXHR9XG5cdGlzSHR0cE1hdGNoKHVybCkge1xuXHRcdHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiaHR0cDpcIiAmJiB0aGlzLmlzSG9zdFBhdGhNYXRjaCh1cmwpO1xuXHR9XG5cdGlzSHR0cHNNYXRjaCh1cmwpIHtcblx0XHRyZXR1cm4gdXJsLnByb3RvY29sID09PSBcImh0dHBzOlwiICYmIHRoaXMuaXNIb3N0UGF0aE1hdGNoKHVybCk7XG5cdH1cblx0aXNIb3N0UGF0aE1hdGNoKHVybCkge1xuXHRcdGlmICghdGhpcy5ob3N0bmFtZU1hdGNoIHx8ICF0aGlzLnBhdGhuYW1lTWF0Y2gpIHJldHVybiBmYWxzZTtcblx0XHRjb25zdCBob3N0bmFtZU1hdGNoUmVnZXhzID0gW3RoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMuaG9zdG5hbWVNYXRjaCksIHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMuaG9zdG5hbWVNYXRjaC5yZXBsYWNlKC9eXFwqXFwuLywgXCJcIikpXTtcblx0XHRjb25zdCBwYXRobmFtZU1hdGNoUmVnZXggPSB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLnBhdGhuYW1lTWF0Y2gpO1xuXHRcdHJldHVybiAhIWhvc3RuYW1lTWF0Y2hSZWdleHMuZmluZCgocmVnZXgpID0+IHJlZ2V4LnRlc3QodXJsLmhvc3RuYW1lKSkgJiYgcGF0aG5hbWVNYXRjaFJlZ2V4LnRlc3QodXJsLnBhdGhuYW1lKTtcblx0fVxuXHRpc1Vua25vd25Qcm90b2NvbCh1cmwpIHtcblx0XHRyZXR1cm4gIXRoaXMucHJvdG9jb2xNYXRjaGVzLmluY2x1ZGVzKHVybC5wcm90b2NvbC5zbGljZSgwLCAtMSkpO1xuXHR9XG5cdGlzUGF0aE1hdGNoKHVybCkge1xuXHRcdGlmICghdGhpcy5wYXRobmFtZU1hdGNoKSByZXR1cm4gZmFsc2U7XG5cdFx0cmV0dXJuIHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMucGF0aG5hbWVNYXRjaCkudGVzdCh1cmwucGF0aG5hbWUpO1xuXHR9XG5cdGlzRmlsZU1hdGNoKHVybCkge1xuXHRcdHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiZmlsZTpcIiAmJiB0aGlzLmlzUGF0aE1hdGNoKHVybCk7XG5cdH1cblx0aXNGdHBNYXRjaChfdXJsKSB7XG5cdFx0dGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IGZ0cDovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG5cdH1cblx0aXNVcm5NYXRjaChfdXJsKSB7XG5cdFx0dGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IHVybjovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG5cdH1cblx0Y29udmVydFBhdHRlcm5Ub1JlZ2V4KHBhdHRlcm4pIHtcblx0XHRjb25zdCBzdGFyc1JlcGxhY2VkID0gdGhpcy5lc2NhcGVGb3JSZWdleChwYXR0ZXJuKS5yZXBsYWNlKC9cXFxcXFwqL2csIFwiLipcIik7XG5cdFx0cmV0dXJuIFJlZ0V4cChgXiR7c3RhcnNSZXBsYWNlZH0kYCk7XG5cdH1cblx0ZXNjYXBlRm9yUmVnZXgoc3RyaW5nKSB7XG5cdFx0cmV0dXJuIHN0cmluZy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIik7XG5cdH1cbn07XG52YXIgSW52YWxpZE1hdGNoUGF0dGVybiA9IGNsYXNzIGV4dGVuZHMgRXJyb3Ige1xuXHRjb25zdHJ1Y3RvcihtYXRjaFBhdHRlcm4sIHJlYXNvbikge1xuXHRcdHN1cGVyKGBJbnZhbGlkIG1hdGNoIHBhdHRlcm4gXCIke21hdGNoUGF0dGVybn1cIjogJHtyZWFzb259YCk7XG5cdH1cbn07XG5mdW5jdGlvbiB2YWxpZGF0ZVByb3RvY29sKG1hdGNoUGF0dGVybiwgcHJvdG9jb2wpIHtcblx0aWYgKCFNYXRjaFBhdHRlcm4uUFJPVE9DT0xTLmluY2x1ZGVzKHByb3RvY29sKSAmJiBwcm90b2NvbCAhPT0gXCIqXCIpIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgYCR7cHJvdG9jb2x9IG5vdCBhIHZhbGlkIHByb3RvY29sICgke01hdGNoUGF0dGVybi5QUk9UT0NPTFMuam9pbihcIiwgXCIpfSlgKTtcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlSG9zdG5hbWUobWF0Y2hQYXR0ZXJuLCBob3N0bmFtZSkge1xuXHRpZiAoaG9zdG5hbWUuaW5jbHVkZXMoXCI6XCIpKSB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIGBIb3N0bmFtZSBjYW5ub3QgaW5jbHVkZSBhIHBvcnRgKTtcblx0aWYgKGhvc3RuYW1lLmluY2x1ZGVzKFwiKlwiKSAmJiBob3N0bmFtZS5sZW5ndGggPiAxICYmICFob3N0bmFtZS5zdGFydHNXaXRoKFwiKi5cIikpIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKG1hdGNoUGF0dGVybiwgYElmIHVzaW5nIGEgd2lsZGNhcmQgKCopLCBpdCBtdXN0IGdvIGF0IHRoZSBzdGFydCBvZiB0aGUgaG9zdG5hbWVgKTtcbn1cbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgSW52YWxpZE1hdGNoUGF0dGVybiwgTWF0Y2hQYXR0ZXJuIH07XG4iXSwieF9n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