AUTHOR = 'Fabien Poupineau'
SITEURL = ""
COPYRIGHT_YEAR = 2025
COPYRIGHT_NAME = 'Fabien Poupineau'
DEFAULT_LANG = 'fr'
TIMEZONE = 'America/Montreal'

PATH = "content"

TIMEZONE = 'EST'

THEME = 'themes/flex'

DEFAULT_LANG = 'FR'

SITENAME = 'Galaxie Basket'
SITETITLE = 'Galaxie Basket'
SITESUBTITLE = 'Pratiques & compétition de basketball\nPlateau Mont-Royal, Montréal'
SITEDESCRIPTION = 'Club de Basketball sur le Plateau Mont-Royal'
SITELOGO = '/images/Logo_GalaxieBasket invert 12.png'

# Feed generation is usually not desired when developing
FEED_ALL_ATOM = None
CATEGORY_FEED_ATOM = None
TRANSLATION_FEED_ATOM = None
AUTHOR_FEED_ATOM = None
AUTHOR_FEED_RSS = None

# Disable automatic page display
DISPLAY_PAGES_ON_MENU = False

# Side bar / Main menu
DISABLE_SIDEBAR = True
MAIN_MENU = False # using a custom one
LINKS = ()
MENUITEMS = (
    ("Calendrier", "/calendar.html"),
    ("Équipes", "/teams.html"),
    ("Association", "/about.html"),
    ("Contact", "/contact.html"),
)

# URL Configuration
PAGE_URL = '{slug}.html'
PAGE_SAVE_AS = '{slug}.html'

# Social widget - not used?
SOCIAL = (
    ('email', 'mailto:info@galaxiebasket.ca'),
)

DEFAULT_PAGINATION = False

STATIC_PATHS = [
    'images',
    'extra',
]
EXTRA_PATH_METADATA = {
    'extra/favicon.ico': {'path': 'favicon.ico'},
    'extra/CNAME': {'path': 'CNAME'},
}

# Uncomment following line if you want document-relative URLs when developing
# RELATIVE_URLS = True
