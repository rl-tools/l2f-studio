document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search)
    if(window.location.hostname === "raptor.rl.tools" || urlParams.get("raptor") === "true"){
        document.getElementById("raptor-project-page").style.display = "block";
        if(urlParams.get("yt") !== "false"){
            document.getElementById("video-container-inner").innerHTML = '<iframe src="https://www.youtube.com/embed/PdRgxDDvUws?si=jToj556_kJDtVbhx" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe>';
        }
        else{
            document.getElementById("video-container").style.display = "none";
        }
    }
})