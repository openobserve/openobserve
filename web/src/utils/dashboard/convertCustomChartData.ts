// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import router from "src/router";

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */
export const runJavaScriptCode = (panelSchema: any, searchQueryData: any) => {
  return new Promise((resolve, reject) => {

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.setAttribute("sandbox", "allow-scripts");
    document.body.appendChild(iframe);
    let staticEchartsRef = '/web/src/assets/dashboard/echarts.min.js';
    if(!window.location.pathname.includes('web')){
      staticEchartsRef = '/src/assets/dashboard/echarts.min.js';
    }
    const scriptContent = `
      <script src="${staticEchartsRef}"></script>
      <script>
        window.onerror = function(message) {
          parent.postMessage({ type: 'error', message: message.toString() }, '*');
        };

        window.addEventListener('message', (event) => {
          if (event.data.type === 'execute') {
            try {
              const userCode = event.data.code.trim();
              const data = JSON.parse(event.data.data);
              const convertFunctionsToString = (obj) => {
                if (typeof obj === 'function') {
                  return obj.toString();  // Convert function to string
                }

                if (Array.isArray(obj)) {
                  return obj.map(item => convertFunctionsToString(item));  // Recursively convert array elements
                }

                if (typeof obj === 'object' && obj !== null) {
                  const result = {};
                  for (const key in obj) {
                    if (obj.hasOwnProperty(key)) {
                      result[key] = convertFunctionsToString(obj[key]);  // Recursively convert object properties
                    }
                  }
                  return result;
                }

                return obj;  // If it's neither a function nor an object/array, return it as is
              };


              // Remove potential harmful patterns
              const cleanedCode = userCode.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*|--.*/g, '').trim();

              // Execute code directly and expect option to be defined
              const userFunction = new Function('data', 'echarts', userCode + '; return option');

              const result = userFunction(data, echarts);
              const convertedData = convertFunctionsToString(result);
              parent.postMessage({ type: 'success', result: JSON.stringify(convertedData) }, '*');
            } catch (error) {
              console.error("[Iframe] Error executing code:", error.message);
              parent.postMessage({ type: 'error', message: error.message }, '*');
            }
          }
        });

      </script>
    `;

    iframe.srcdoc = scriptContent;
    window.addEventListener("message", function handler(event) {
      if (event.source !== iframe.contentWindow) return;


      window.removeEventListener("message", handler);
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);

      if (event.data.type === "success") {
        resolve(JSON.parse(event.data.result));
      } else if (event.data.type === "error") {
        console.error("Error executing code", event.data.message);
        reject(new Error(event.data.message));
      }
    });

    iframe.onload = () => {

      iframe?.contentWindow?.postMessage(
        {
          type: "execute",
          code: panelSchema.customChartContent,
          data: JSON.stringify(searchQueryData),
        },
        "*"
      );
    };
  });
};


