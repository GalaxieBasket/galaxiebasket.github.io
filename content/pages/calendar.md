Title: Calendrier
Slug: calendar

<div id="basketball-calendar"></div>

<div id="loading" style="text-align: center; padding: 40px; color: #eed175;">
    <h2>Chargement du calendrier... 🏀</h2>
</div>

<link href='https://cdnjs.cloudflare.com/ajax/libs/fullcalendar/6.1.10/index.min.css' rel='stylesheet' />
<script src='https://cdnjs.cloudflare.com/ajax/libs/fullcalendar/6.1.10/index.global.min.js'></script>

<style>
#basketball-calendar {
    max-width: 1100px;
    margin: 40px auto;
    padding: 20px;
    background: rgba(45, 45, 45, 0.9);
    border-radius: 15px;
    border: 1px solid rgba(238, 209, 117, 0.2);
    display: none;
}

#loading {
    background: rgba(45, 45, 45, 0.9);
    border-radius: 15px;
    border: 1px solid rgba(238, 209, 117, 0.2);
    max-width: 600px;
    margin: 40px auto;
}

.fc {
    color: #e0e0e0;
}

.fc .fc-button-primary {
    background: linear-gradient(45deg, #eed175, #e6d45a) !important;
    border: none !important;
    color: #1a1a1a !important;
    font-weight: 600;
    text-transform: uppercase;
}

.fc .fc-button-primary:hover {
    background: linear-gradient(45deg, #e6d45a, #dcc83f) !important;
}

.fc .fc-button-primary:disabled {
    opacity: 0.5;
}

.fc-theme-standard td,
.fc-theme-standard th {
    border-color: rgba(238, 209, 117, 0.2) !important;
}

.fc-day-today {
    background: rgba(238, 209, 117, 0.1) !important;
}

.fc-daygrid-day-number {
    color: #e0e0e0 !important;
}

.fc-daygrid-event-dot {
    display: none;
}

.fc-col-header-cell {
    background: rgba(30, 30, 30, 0.95) !important;
    color: #eed175 !important;
    font-weight: 700;
    text-transform: uppercase;
}

.fc-event {
    border: none !important;
    border-radius: 5px;
    padding: 2px 5px;
}

.fc-event-title {
    font-weight: 500;
}

.fc-event-match {
    background: linear-gradient(45deg, #47daed, #38c5d9) !important;
    color: #1a1a1a !important;
}

.fc-event-training {
    background: rgba(238, 209, 117, 0.3) !important;
    color: #eed175 !important;
    border: 1px solid #eed175 !important;
}

.fc-event-special {
    background: rgba(71, 218, 237, 0.3) !important;
    color: #47daed !important;
    border: 1px solid #47daed !important;
}

.fc-popover {
    background: rgba(30, 30, 30, 0.98) !important;
    border: 2px solid #eed175 !important;
    border-radius: 10px;
    color: #e0e0e0 !important;
}

.fc-popover-header {
    background: rgba(238, 209, 117, 0.2) !important;
    color: #eed175 !important;
}

.event-modal {
    display: none;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(30, 30, 30, 0.98);
    border: 2px solid #eed175;
    border-radius: 15px;
    padding: 2rem;
    max-width: 500px;
    width: 90%;
    z-index: 10000;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.event-modal h2 {
    color: #eed175;
    margin-bottom: 1rem;
}

.event-modal p {
    color: #d0d0d0;
    margin: 0.5rem 0;
}

.event-modal .close-btn {
    background: linear-gradient(45deg, #eed175, #e6d45a);
    border: none;
    border-radius: 25px;
    color: #1a1a1a;
    font-weight: 600;
    padding: 10px 20px;
    cursor: pointer;
    margin-top: 1rem;
}

.modal-overlay {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    z-index: 9999;
}
</style>

<div class="modal-overlay" id="modalOverlay" onclick="closeModal()"></div>
<div class="event-modal" id="eventModal">
    <h2 id="modalTitle"></h2>
    <div id="modalContent"></div>
    <button class="close-btn" onclick="closeModal()">Fermer</button>
</div>

<script>
function generateRecurringTrainings(trainings, startDate, endDate) {
    const events = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    trainings.forEach(training => {
        let current = new Date(start);
        
        while (current.getDay() !== training.dayOfWeek) {
            current.setDate(current.getDate() + 1);
        }
        
        while (current <= end) {
            const endTime = new Date(current);
            const [hours, minutes] = training.time.split(':');
            endTime.setHours(parseInt(hours) + training.duration, parseInt(minutes), 0);
            
            events.push({
                title: `${training.description}`,
                start: `${current.toISOString().split('T')[0]}T${training.time}:00`,
                end: endTime.toISOString().split('T')[0] + 'T' + 
                     endTime.toTimeString().split(' ')[0],
                className: 'fc-event-training',
                extendedProps: {
                    type: 'training',
                    location: training.location,
                    team: training.team,
                    description: training.description
                }
            });
            
            current.setDate(current.getDate() + 7);
        }
    });
    
    return events;
}

function processEventsData(data) {
    const events = [];
    
    data.matches.forEach(match => {
        
        events.push({
            title: `Vs ${match.opponent}`,
            start: `${match.date}T${match.time}:00`,
            className: "fc-event-match",
            extendedProps: {
                type: 'match',
                opponent: match.opponent,
                location: match.location,
                team: match.team
            }
        });
    });
    
    const today = new Date();
    const threeMonthsLater = new Date(today);
    threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
    
    const trainingEvents = generateRecurringTrainings(
        data.trainings,
        today.toISOString().split('T')[0],
        threeMonthsLater.toISOString().split('T')[0]
    );
    events.push(...trainingEvents);
    
    data.special_events.forEach(event => {
        const eventData = {
            className: 'fc-event-special',
            extendedProps: {
                type: event.type,
                description: event.description,
                location: event.location
            }
        };
        
        if (event.type === 'event') {
            eventData.title = `⭐ ${event.title}`;
        } else if (event.type === 'tournament') {
            eventData.title = `🏆 ${event.title}`;
        }
        
        // Si l'heure est spécifiée, l'utiliser
        if (event.time) {
            eventData.start = `${event.date}T${event.time}:00`;
        } else {
            // Sinon, événement "toute la journée"
            eventData.start = event.date;
            eventData.allDay = true;
            eventData.display = 'background';
        }
        
        events.push(eventData);
    });
    
    return events;
}

function showEventDetails(info) {
    const event = info.event;
    const props = event.extendedProps;
    
    let content = '';
    
    const dateStr = event.start.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const timeStr = event.start.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    content += `<p><strong>📅 Date:</strong> ${dateStr}</p>`;
    content += `<p><strong>🕐 Heure:</strong> ${timeStr}</p>`;
    
    if (props.type === 'match') {
        content += `<p><strong>⚔️ Adversaire:</strong> ${props.opponent}</p>`;
        content += `<p><strong>📍 Lieu:</strong> ${props.location}</p>`;
        content += `<p><strong>🏀 Équipe:</strong> ${props.team}</p>`;
    } else if (props.type === 'training') {
        content += `<p><strong>📍 Lieu:</strong> ${props.location}</p>`;
        content += `<p><strong>🏀 Équipe:</strong> ${props.team}</p>`;
        if (event.end) {
            const endTimeStr = event.end.toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit'
            });
            content += `<p><strong>⏱️ Fin:</strong> ${endTimeStr}</p>`;
        }
    } else if (props.type === 'special') {
        content += `<p><strong>📍 Lieu:</strong> ${props.location}</p>`;
        content += `<p><strong>ℹ️ Description:</strong> ${props.description}</p>`;
    } else if (props.type === 'tournament') {
        content += `<p><strong>📍 Lieu:</strong> ${props.location}</p>`;
        content += `<p><strong>ℹ️ Description:</strong> ${props.description}</p>`;
    }
    
    document.getElementById('modalTitle').textContent = event.title;
    document.getElementById('modalContent').innerHTML = content;
    document.getElementById('eventModal').style.display = 'block';
    document.getElementById('modalOverlay').style.display = 'block';
}

function closeModal() {
    document.getElementById('eventModal').style.display = 'none';
    document.getElementById('modalOverlay').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function() {
    fetch('/extra/events.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Erreur de chargement des événements');
            }
            return response.json();
        })
        .then(data => {
            const events = processEventsData(data);

            document.getElementById('loading').style.display = 'none';

            const calendarEl = document.getElementById('basketball-calendar');
            calendarEl.style.display = 'block';

            const calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'dayGridMonth',
                locale: 'fr',
                timeZone: 'America/New_York',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'dayGridMonth,timeGridWeek,listMonth'
                },
                buttonText: {
                    today: "Aujourd'hui",
                    month: 'Mois',
                    week: 'Semaine',
                    list: 'Liste'
                },
                height: 'auto',
                events: events,
                eventClick: showEventDetails,
                displayEventTime: false,
                eventTimeFormat: {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }
            });
            
            calendar.render();
        })
        .catch(error => {
            console.error('Erreur:', error);
            document.getElementById('loading').innerHTML = `
                <h2 style="color: #ff6b6b;">❌ Erreur de chargement</h2>
                <p>Impossible de charger les événements. Veuillez réessayer plus tard.</p>
            `;
        });
});
</script>