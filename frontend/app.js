import { AuthApp } from './classes/AuthApp.js';

document.addEventListener('DOMContentLoaded', () => {
    const authApp = new AuthApp();
    window.authApp = authApp;


    window.handleModalPlotError = function(imgElement) {
        imgElement.onerror = null;
        imgElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDQwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNGMEYwRjAiLz48dGV4dCB4PSIyMDAiIHk9IjEwMCIgZm9udC1mYW1pbHk9IkludGVyIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjQ3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+R3JhcGggbm90IGF2YWlsYWJsZTwvdGV4dD48L3N2Zz4=';
        imgElement.classList.remove('loading');
    };
});