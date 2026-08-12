document.addEventListener("DOMContentLoaded", function () {
    const startButton = document.getElementById("start");
    const next1Button = document.getElementById("next1");
    const restartButton = document.getElementById("restart");
    const codeElement = document.getElementById("code");
    const saveButton = document.getElementById("save");
    const menuContainer = document.getElementById("menu");
    const gameScreenContainer = document.getElementById("gameScreen");
    const gameContainer = document.getElementById("game");
    const breakContainer1 = document.getElementById("break1");
    const breakContainer2 = document.getElementById("break2");
    const instructionsContainer0 = document.getElementById("instructions0");
    const instructionsContainer1 = document.getElementById("instructions1");
    const instructionsContainer2 = document.getElementById("instructions2");
    const instructionsContainer3 = document.getElementById("instructions3");
    const resultsContainer = document.getElementById("resultContainer");
    const countdownElement = document.getElementById("countdown");
    const endingElement = document.getElementById("ending");
    const clickCountElement = document.getElementById("clickCount");
    const targetEfficiencyElement = document.getElementById("targetEfficiency");
    const targetCountElement = document.getElementById("targetCount");
    const hitCountElement = document.getElementById("hitCount");
    const targetHitCountElement = document.getElementById("targetHitCount");
    const accuracyElement = document.getElementById("accuracy");
    const targetColorInput = document.getElementsByName("tgtcolor");
    const bgColorInput = document.getElementsByName("bgcolor");
    const targetSizeInput = document.getElementById("tgtsize");
    const difficultyLevelInput = document.getElementById("diff");
    const durationElement = document.getElementById("duration");
    const cursorType = document.getElementsByName("cursorType");
    let timerElement = document.getElementById('timeLeft');



    let gameInterval;
    let clickCount = 0;
    let hitCount = 0;
    let targetSize = 75;
    let targetColor = "";
    let cursorTypeValue = "";
    let bgColor = "";
    let isGameActive = false;
    let numberOfTargets = 0;
    let finalClick = 0;
    let finalHit = 0;
    let finalTargets = 0;
    let score = 0;
    let code;
    let accuracy_s1;
    let accuracy_s2;
    let accuracy_s3;
    let accuracy_F;
    let targetEfficiency_s1;
    let targetEfficiency_s2;
    let targetEfficiency_s3;
    let targetEfficiency_F;
    let series = 0;
    let first = 0;

    next1Button.addEventListener('click', function(event){
        code = codeElement.value;
        // targetSize = targetSize*parseInt(targetSizeInput.value);
        
        menuContainer.style.display = "none";
        if(first == 0)
        instructionsContainer0.style.display = "block";
        else if(first == 1){
            next1Button.style.display = "none";
            instructionsContainer0.style.display = "none";
            instructionsContainer1.style.display = "block";
            startButton.style.display = "block";
        }
        
        first+=1

    })

    startButton.addEventListener('click', function(event) {
        
        startButton.style.display = "none";
        instructionsContainer0.style.display = "none";
        instructionsContainer1.style.display = "none";
        instructionsContainer2.style.display = "none";
        instructionsContainer3.style.display = "none";
        series += 1;
        startGame(series);  // call startGame with the initial round number
    });

    restartButton.addEventListener('click', function(event) {
        location.reload();
    });

    document.getElementById('save').addEventListener('click', function() {
        const scoreData = { 
            code: code,
            accuracy_s1: accuracy_s1,
            targetEfficiency_s1: targetEfficiency_s1,
            accuracy_s2: accuracy_s2,
            targetEfficiency_s2: targetEfficiency_s2,
            accuracy_s3: accuracy_s3,
            targetEfficiency_s3: targetEfficiency_s3,
            accuracy_F: accuracy_F,
            targetEfficiency_F: targetEfficiency_F
        }; // Assume score is your variable holding the score
    
        fetch('/saveScore', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(scoreData),
        })
        .then(response => response.text())
        .then(data => {
            alert(data);
            saveButton.style.display = "block";
        });
    });
    


   
        
    function startGame(i = 1){
        menuContainer.style.display = "none";
        startCountdown(3, i);
        
    }

    function beginGame(iteration){
        gameScreenContainer.style.display = "block";
        gameContainer.style.display = "block";
        timerElement.style.display = "block";
        cursorTypeValue = getSelectedValue(cursorType);
        bgColor = getSelectedValue(bgColorInput);
        gameScreenContainer.style.cursor = cursorTypeValue;
        gameScreenContainer.style.backgroundColor = bgColor;
        start.style.display = "none";
        clickCount = 0;
        hitCount = 0;
        numberOfTargets = 0;
        accuracyElement.textContent = "0%";
        targetColor = getSelectedValue(targetColorInput);
        //bgColor = getSelectedValue(bgColorInput);

        isGameActive = true;
        const difficultyLevel = parseFloat(difficultyLevelInput.value);
        //spawnTarget();
        const durationTime = parseFloat(durationElement.value)*60000;
        let timeLeft = parseInt(durationTime / 1000);
        const gameTimer = setInterval(() => {
            timeLeft--;  // decrease the time
            if(timeLeft <= 5){
                endingElement.style.display = "block";
                endingElement.textContent = timeLeft;

            }
            timerElement.textContent = formatTime(timeLeft);
            if (timeLeft <= 0) {
                clearInterval(gameTimer);
                endingElement.style.display = "none";
            }
        }, 1000);

        gameInterval = setInterval(()=> {
            if(!isGameActive){
                clearInterval(gameInterval);
                return;
            }
            numberOfTargets+=1;
            spawnTarget(); 
        },difficultyLevel*1000);
        
        setTimeout(()=>{
            endGame(iteration);
        }, durationTime);

    }

    function spawnTarget() {
        const target = document.createElement('div');
        target.classList.add('target');    
        target.style.backgroundColor = targetColor;
        gameContainer.style.cursor = cursorTypeValue;
        target.style.width = `${targetSize}px`;
        target.style.height = `${targetSize}px`;
        //target.style.animation = "zoomInOut "+`${difficultyLevel}s`+" infinite";
        target.style.top = `${getRandomNumber(20, 80)}%`;
        target.style.left = `${getRandomNumber(20, 80)}%`;
        target.style.bottom = `${getRandomNumber(20, 80)}%`;
        target.style.right = `${getRandomNumber(20, 80)}%`;
        //const difficultyLevel = parseInt(difficultyLevelInput.value);
        target.addEventListener("click", function () {
            hitCount++;
            //updateStats();
            target.style.display = "none";
        });
        gameContainer.appendChild(target);
        setTimeout(()=>{
            target.remove();
        }, 4000);
    }

    

    document.addEventListener("click", function () {
        clickCount++;
        //updateStats();
    });

    function updateStats(iteration) {
        if(iteration==1){
            finalClick += clickCount;
            finalHit += hitCount;
            finalTargets += numberOfTargets;
            document.getElementById('clickCount1').textContent = clickCount;
            document.getElementById('hitCount1').textContent = hitCount;
            if(clickCount==0){
                document.getElementById('accuracy1').textContent = '0%'
            }
            else{
                accuracy_s1 = (hitCount / clickCount) * 100;
                document.getElementById('accuracy1').textContent = `${accuracy_s1.toFixed(2)}%`;
            }
            document.getElementById('targetCount1').textContent = numberOfTargets;
            targetEfficiency_s1 = (hitCount / numberOfTargets)*100;
            document.getElementById('targetHitCount1').textContent = hitCount;
            document.getElementById('targetEfficiency1').textContent = `${targetEfficiency_s1.toFixed(2)}%`
        }
        else if(iteration==2){
            finalClick += clickCount;
            finalHit += hitCount;
            finalTargets += numberOfTargets;
            document.getElementById('clickCount2').textContent = clickCount;
            document.getElementById('hitCount2').textContent = hitCount;
            if(clickCount==0){
                document.getElementById('accuracy2').textContent = '0%'
            }
            else{
                accuracy_s2 = (hitCount / clickCount) * 100;
                document.getElementById('accuracy2').textContent = `${accuracy_s2.toFixed(2)}%`;
            }
            document.getElementById('targetCount2').textContent = numberOfTargets;
            targetEfficiency_s2 = (hitCount / numberOfTargets)*100;
            document.getElementById('targetHitCount2').textContent = hitCount;
            document.getElementById('targetEfficiency2').textContent = `${targetEfficiency_s2.toFixed(2)}%`
        }
        else if(iteration==3){
            finalClick += clickCount;
            finalHit += hitCount;
            finalTargets += numberOfTargets;
            document.getElementById('clickCount3').textContent = clickCount;
            document.getElementById('hitCount3').textContent = hitCount;
            if(clickCount==0){
                document.getElementById('accuracy3').textContent = '0%'
            }
            else{
                accuracy_s3 = (hitCount / clickCount) * 100;
                document.getElementById('accuracy3').textContent = `${accuracy_s3.toFixed(2)}%`;
            }
            document.getElementById('targetCount3').textContent = numberOfTargets;
            targetEfficiency_s3 = (hitCount / numberOfTargets)*100;
            document.getElementById('targetHitCount3').textContent = hitCount;
            document.getElementById('targetEfficiency3').textContent = `${targetEfficiency_s3.toFixed(2)}%`
            clickCountElement.textContent = finalClick;
            hitCountElement.textContent = finalHit;
            accuracy_F = (finalHit / finalClick) * 100;
            accuracyElement.textContent = `${accuracy_F.toFixed(2)}%`;
            targetCountElement.textContent = finalTargets;
            targetEfficiency_F = (finalHit / finalTargets)*100;
            targetEfficiencyElement.textContent = `${targetEfficiency_F.toFixed(2)}%`
            targetHitCountElement.textContent = finalHit;
        }
            

        
        




    }

    function endGame(iteration) {
        isGameActive = false;
        clearInterval(gameInterval);
        gameScreenContainer.style.display = "none";
        gameContainer.style.display = "none";
        timerElement.style.display = "none";
        document.body.style.cursor = "auto";
        updateStats(iteration);
        if (iteration < 3){
            if (iteration == 1)
            breakContainer1.style.display = "block";
            else if (iteration == 2)
            breakContainer2.style.display = "block";
            startCountdown(90, iteration+1);
        }
        else{
            setTimeout(() => {
                restartButton.style.display = "block";
                saveButton.style.display = "block";
            }, 1000);
             
             resultsContainer.style.display="block";

        }
        
    }

    function startCountdown(seconds, iteration) {
        let given = seconds;
        countdownElement.style.display = "block";
        countdownElement.textContent = seconds;
        const countdownInterval = setInterval(() => {
            seconds--;
            if (seconds <= 0) {
                clearInterval(countdownInterval);
                countdownElement.style.display = "none";
                endingElement.style.display = "none";
                if (given == 3)
                beginGame(iteration);
                else {
                    if(iteration==2){
                    breakContainer1.style.display = "none";
                    instructionsContainer2.style.display = "block";
                    startButton.style.display = "block";
                   }
                else{
                    breakContainer2.style.display = "none";
                    instructionsContainer3.style.display = "block";
                    startButton.style.display = "block";
                }
            }

            }
            else{
                countdownElement.textContent = seconds;
            }
        }, 1000);
    }

    function getRandomNumber(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function getSelectedValue(ele){
        for(i=0; i<ele.length; i++){
            if (ele[i].checked == true){
                return ele[i].value;
            }
        }
    }

    function formatTime(seconds) {
        let minutes = Math.floor(seconds / 60);
        let remainingSeconds = seconds % 60;
        
        // Ensure that both minutes and seconds are two digits
        minutes = (minutes < 10 ? '0' : '') + minutes;
        remainingSeconds = (remainingSeconds < 10 ? '0' : '') + remainingSeconds;
    
        return `${minutes}:${remainingSeconds}`;
    }
    
});

