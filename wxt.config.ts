import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: [],
  manifest: {
    name: 'Chetty - Floating Chatbot',
    description: 'Cross-browser floating chatbot inside web pages powered by Gemini, deep-chat, context gathering, and session sync.',
    version: '1.0.0',
    permissions: [
      'storage',
      'tabs',
      'activeTab',
      'scripting'
    ],
    host_permissions: [
      '<all_urls>'
    ],
    action: {
      default_title: 'Chetty - Chatbot Sessions & Settings',
      default_popup: 'popup.html'
    },
    browser_specific_settings: {
      gecko: {
        id: 'chetty-extension@google.com',
        strict_min_version: '109.0'
      }
    },
    icons: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    }
  }
});
