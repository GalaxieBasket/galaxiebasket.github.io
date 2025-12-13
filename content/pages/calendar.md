Title: Calendrier
Slug: calendar

<div id="basketball-calendar"></div>

<div id="loading" style="text-align: center; padding: 40px; color: #eed175;">
    <h2>Chargement du calendrier... 🏀</h2>
</div>

<link href='https://cdnjs.cloudflare.com/ajax/libs/fullcalendar/6.1.10/index.min.css' rel='stylesheet' />
<script src='https://cdnjs.cloudflare.com/ajax/libs/fullcalendar/6.1.10/index.global.min.js'></script>

<link href='/calendar.css' rel='stylesheet' />
<script src='/calendar.js'></script>

<div class="modal-overlay" id="modalOverlay" onclick="closeModal()"></div>
<div class="event-modal" id="eventModal">
    <h2 id="modalTitle"></h2>
    <div id="modalContent"></div>
    <button class="close-btn" onclick="closeModal()">Fermer</button>
</div>