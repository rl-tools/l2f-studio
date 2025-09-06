document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search)
    if(window.location.hostname === "raptor.rl.tools" || urlParams.get("raptor") === "true"){
        document.getElementById("raptor-project-page").style.display = "block";
    }
})