AUTHOR = 'Fabien Poupineau'
SITENAME = 'Galaxie Basket'
SITEURL = ""
COPYRIGHT_YEAR = 2025
COPYRIGHT_NAME = 'Fabien Poupineau'
EXTRA_FOOTER = 'Made with Pelican'

PATH = "content"

TIMEZONE = 'EST'

THEME = 'themes/flex'

DEFAULT_LANG = 'FR'

SITELOGO = '/images/GalaxieBasket_Logo-05.png'

# Feed generation is usually not desired when developing
FEED_ALL_ATOM = None
CATEGORY_FEED_ATOM = None
TRANSLATION_FEED_ATOM = None
AUTHOR_FEED_ATOM = None
AUTHOR_FEED_RSS = None

# Disable automatic page display
DISPLAY_PAGES_ON_MENU = False

# Side bar
LINKS = (
    ("Accueil", "/"),
    ("A propos", "/about.html"),
)

# Social widget - not used?
SOCIAL = (
    ('email', 'mailto:info@galaxiebasket.ca'),
)

DEFAULT_PAGINATION = False

# Add custom CSS
CUSTOM_CSS = 'static/flex_custom_colors.css'

# Make sure Pelican copies your CSS file
STATIC_PATHS = ['images', 'extra/flex_custom_colors.css']
EXTRA_PATH_METADATA = {
    'extra/flex_custom_colors.css': {'path': 'static/flex_custom_colors.css'},
}

# Uncomment following line if you want document-relative URLs when developing
# RELATIVE_URLS = True
