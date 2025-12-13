// Galaxie Basket - Calendar Logic

function datesAreOnSameDay(d1, d2) {
    const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return utc1 === utc2;
}

function generateRecurringTrainings(trainings) {
        const events = [];
    
    trainings.forEach(training => {
        let current = new Date(training.startDate);
        const end = new Date(training.endDate);        
        
        while (current.getDay() !== training.dayOfWeek) {
            current.setDate(current.getDate() + 1);
        }

        exceptions = training.except.map(rawDate => new Date(rawDate + " UTC-5"));
        
        while (current <= end) {
            const dateIsExempt = exceptions.some(date => datesAreOnSameDay(date, current));
            if (!dateIsExempt) {
                const startTime = new Date(current);
                const [hours, minutes] = training.time.split(':');
                startTime.setHours(parseInt(hours), parseInt(minutes), 0);
                
                const endTime = new Date(startTime);
                const [hours_duration, minutes_duration] = training.duration.split(':');
                endTime.setHours(endTime.getHours() + parseInt(hours_duration), endTime.getMinutes() + parseInt(minutes_duration), 0);

                events.push({
                    title: `${training.description}`,
                    start: startTime.toISOString(),
                    end: endTime.toISOString(),
                    className: 'fc-event-training',
                    extendedProps: {
                        type: 'training',
                        location: training.location,
                        team: training.team,
                        description: training.description
                    }
                });
            }
            
            current.setDate(current.getDate() + 7);
        }
    });
    
    return events;
}

function processEventsData(data) {
    const events = [];
    
    data.matches.forEach(match => {
        events.push({
            title: "Match",
            start: `${match.date}T${match.time}:00`,
            className: "fc-event-match",
            extendedProps: {
                type: 'match',
                opponent: match.opponent,
                location: match.location,
                team: match.team,
                result: match.result,
                home: match.home
            }
        });
    });
    
    const today = new Date();
    const threeMonthsLater = new Date(today);
    threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
    
    const trainingEvents = generateRecurringTrainings(data.trainings);
    events.push(...trainingEvents);
    
    data.special_events.forEach(event => {
        const eventData = {
            className: 'fc-event-special',
            extendedProps: {
                type: event.type,
                description: event.description,
                location: event.location,
                url: event.url
            }
        };
        
        if (event.type === 'event') {
            eventData.title = event.title;
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

    const timeOptions = {
        hour: '2-digit',
        minute: '2-digit',
    };
    
    const dateStr = event.start.toLocaleDateString('fr-CA', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const timeStr = event.start.toLocaleTimeString('fr-CA', timeOptions);
    
    let title = event.title;
    let content = '';
    content += `<p><strong>📅 Date:</strong> ${dateStr}</p>`;
    content += `<p><strong>🕐 Heure:</strong> ${timeStr}</p>`;
    
    if (props.type === 'match') {
        title = 'Match';

        let middle = ' Vs ';
        const firstTeam = props.home ? props.team : props.opponent;
        const secondTeam = props.home ? props.opponent : props.team;

        if (props.result) {
            const [home, away] = props.result.split('-');
            const homeWins = parseInt(home) > parseInt(away);

            if (homeWins) {
                middle = `<p><strong>${firstTeam} ${home}</strong>-${away} ${secondTeam}</p>`;
            } else {
                middle = `<p>${firstTeam} ${home}-<strong>${away} ${secondTeam}</strong></p>`;
            }
        } else {
            middle = `<p>${firstTeam} Vs ${secondTeam}</p>`;
        }
        content += middle
        content += `<p><strong>📍 Lieu:</strong> ${props.location}</p>`;
    } else if (props.type === 'training') {
        content += `<p><strong>📍 Lieu:</strong> ${props.location}</p>`;
        content += `<p><strong>🏀 Équipe:</strong> ${props.team}</p>`;
        if (event.end) {
            const endTimeStr = event.end.toLocaleTimeString('fr-CA', timeOptions);
            content += `<p><strong>⏱️ Fin:</strong> ${endTimeStr}</p>`;
        }
    } else if (props.type === 'special') {
        content += `<p><strong>📍 Lieu:</strong> ${props.location}</p>`;
        content += `<p><strong>ℹ️ Description:</strong> ${props.description}</p>`;
    } else if (props.type === 'tournament') {
        content += `<p><strong>📍 Lieu:</strong> ${props.location}</p>`;
        content += `<p><strong>ℹ️ Description:</strong> ${props.description}</p>`;
    }
    
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalContent').innerHTML = content;
    document.getElementById('eventModal').style.display = 'block';
    document.getElementById('modalOverlay').style.display = 'block';
}

function closeModal() {
    document.getElementById('eventModal').style.display = 'none';
    document.getElementById('modalOverlay').style.display = 'none';
}

// Initialisation du calendrier
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
                locale: 'fr-CA',
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