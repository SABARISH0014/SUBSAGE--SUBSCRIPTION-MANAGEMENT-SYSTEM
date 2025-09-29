// Theme Toggle Logic
const toggleTheme = () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Change the theme icon accordingly
    const themeIcon = document.getElementById('theme-icon');
    if (newTheme === 'dark') {
        themeIcon.src = "/images/sun.png";  // Use sun icon for dark mode
    } else {
        themeIcon.src = "/images/moon.png"; // Use moon icon for light mode
    }
};

// Apply saved theme on page load
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Set the icon based on the saved theme
    const themeIcon = document.getElementById('theme-icon');
    if (savedTheme === 'dark') {
        themeIcon.src = "/images/sun.png";  // Sun icon for dark mode
    } else {
        themeIcon.src = "/images/moon.png"; // Moon icon for light mode
    }

    // Add event listener for theme toggle button
    const toggleButton = document.getElementById('theme-toggle');
    if (toggleButton) {
        toggleButton.addEventListener('click', toggleTheme);
    }
});
