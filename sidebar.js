document.addEventListener('DOMContentLoaded', () => {
    const sidebarResizer = document.getElementById('sidebar-resizer');
    const vehicleContainer = document.getElementById('vehicle-container');
    const simContainer = document.getElementById('sim-container');
    let isResizing = false;
    let dragStartX = 0; 
    let didMove = false; 
    if(localStorage.getItem('vehicle-container-width') !== null) {
        vehicleContainer.style.width = localStorage.getItem('vehicle-container-width')
        window.dispatchEvent(new Event('resize'));
    }

    sidebarResizer.addEventListener('mousedown', initResize);
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);

    sidebarResizer.addEventListener('click', e => {
        if (didMove) {
            e.stopPropagation();
            e.preventDefault();
            return;
        }
        vehicleContainer.style.width = '0px';
        localStorage.setItem('vehicle-container-width', '0px');
        window.dispatchEvent(new Event('resize'));
    });

    function initResize(e) {
        isResizing = true;
        didMove = false;
        dragStartX = e.clientX;
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    }

    function resize(e) {
        if (!isResizing) return;

        if (Math.abs(e.clientX - dragStartX) > 3) {
            didMove = true;
        }
        
        const containerRect = sidebarResizer.parentElement.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left - sidebarResizer.getBoundingClientRect().width / 2;
        
        vehicleContainer.style.width = `${newWidth}px`;
        simContainer.style.flexGrow = 1;
        window.dispatchEvent(new Event('resize'));
        localStorage.setItem('vehicle-container-width', newWidth);
    }

    function stopResize() {
        isResizing = false;
        document.body.style.cursor = 'default';
        window.dispatchEvent(new Event('resize'));
    }

});