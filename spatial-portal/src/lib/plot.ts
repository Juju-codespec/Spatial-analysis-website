// react-plotly.js default export breaks under Vite + plotly.js v3 (namespace
// object instead of a component). The factory pattern is the supported fix.
// Use the pre-bundled browser build to avoid Node polyfill issues in Vite.
import createPlotlyFactory from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
import type { ComponentType } from 'react';
import type { PlotParams } from 'react-plotly.js';

// Vite's dep pre-bundle can surface the CJS module object instead of its
// default export; unwrap so the app doesn't crash with a blank screen.
const createPlotlyComponent =
  typeof createPlotlyFactory === 'function'
    ? createPlotlyFactory
    : (createPlotlyFactory as { default: (plotly: typeof Plotly) => ComponentType<PlotParams> }).default;

const Plot = createPlotlyComponent(Plotly);
export default Plot;
