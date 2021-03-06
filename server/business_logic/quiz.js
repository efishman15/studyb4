// Retrieve
var sessionUtils = require("../business_logic/session");
var async = require('async');
var excptions = require('../utils/exceptions');
var random = require('../utils/random');
var dal = require('../dal/myMongoDB');
var generalUtils = require('../utils/general');

module.exports.subjects = function (req, res, next) {

    var token = req.headers.authorization;
    var postData = req.body;

    var operations = [

        //Connect
        function (callback) {
            sessionUtils.getSession(token, callback);
        },

        //get subjects
        function (dbHelper, session, callback) {
            dal.getSubjects(dbHelper, postData.quizLanguage, false, callback);
        },

        //Close the db
        function (dbHelper, subjects, callback) {
            dbHelper.close();
            callback(null, subjects);
        }
    ];

    async.waterfall(operations, function (err, subjects) {
        if (!err) {
            res.json(subjects);
        }
        else {
            res.send(err.status, err);
        }
    })
}

module.exports.start = function (req, res, next) {
    var token = req.headers.authorization;
    var postData = req.body;

    var operations = [

            //Connect
            function (callback) {
                sessionUtils.getSession(token, callback);
            },

            //Init quiz
            function (dbHelper, session, callback) {
                var quiz = {serverData: {previousQuestions: []}, clientData: {}};

                quiz.clientData.totalQuestions = 5;
                quiz.clientData.currentQuestionIndex = 0;
                quiz.clientData.finished = false;
                quiz.serverData.score = 0;

                var quizSubjects;
                if (postData.subjects) {
                    quizSubjects = postData.subjects;
                }
                else if (session.profiles[session.settings.profileId].subjects && session.profiles[session.settings.profileId].subjects.length > 0) {
                    quizSubjects = session.profiles[session.settings.profileId].subjects
                }

                if (!quizSubjects || quizSubjects.length == 0) {
                    callback(new excptions.GeneralError(424, "No subjects sent and current profile does not have subjects, admin: " + session.adminId + ", profile: " + session.profiles[session.settings.profileId].name));
                    return;
                }

                //Attach the selected subjects to the quiz
                dal.getSubjects(dbHelper, session.profiles[session.settings.profileId].quizLanguage, true, function (err, dbHelper, subjects) {
                    if (err) {
                        callback(new excptions.GeneralError(424, "Error retrieving subjects for quiz language: " + session.profiles[session.settings.profileId].quizLanguage));
                        return;
                    }

                    quiz.subjects = [];
                    for (var i = 0; i < subjects.length; i++) {
                        for (var j = 0; j < quizSubjects.length; j++) {
                            if (subjects[i].subjectId == quizSubjects[j]) {
                                quiz.subjects.push({"subjectId": subjects[i].subjectId, "topics": subjects[i].topics})
                                break;
                            }
                        }
                    }

                    session.quiz = quiz;

                    callback(null, dbHelper, session)

                })
            },

            //Pick a random subject from the avilable subjects in this quiz and prepare the query
            prepareQuestionCriteria,

            //Count number of questions excluding the previous questions
            getQuestionsCount,

            //Get the next question for the quiz
            getNextQuestion,

            //Sets the direction of the question
            setQuestionDirection,

            //Stores the session with the quiz in the db
            sessionUtils.storeSession,

            //Close the db
            function (dbHelper, session, callback) {
                dbHelper.close();
                callback(null, session.quiz.clientData);
            }
        ]
        ;

    async.waterfall(operations, function (err, quizClientData) {
        if (!err) {
            res.send(200, quizClientData);
        }
        else {
            res.send(err.status, err);
        }
    })
}
;

module.exports.answer = function (req, res, next) {
    var token = req.headers.authorization;
    var answer = req.body;
    var result = {};

    var operations = [

        //Connect
        function (callback) {
            sessionUtils.getSession(token, callback);
        },

        //Check answer
        function (dbHelper, session, callback) {
            var answers = session.quiz.serverData.currentQuestion.answers;
            var answerId = parseInt(answer.id, 10);
            if (answerId < 1 || answerId > answers.length) {
                callback(new excptions.GeneralError(424, "Invalid answer id: " + answer.id));
            }

            result.answerId = answerId;
            if (answers[answerId - 1].correct) {
                result.correct = true;
                session.quiz.serverData.score += Math.ceil(100 / session.quiz.clientData.totalQuestions);
            }
            else {
                result.correct = false;
                for (i = 0; i < answers.length; i++) {
                    if (answers[i].correct && answers[i].correct == true) {
                        result.correctAnswerId = i + 1;
                        break;
                    }
                }
            }

            result.score = session.quiz.serverData.score;
            callback(null, dbHelper, session);
        },

        function (dbHelper, session, callback) {

            var store = false;
            if (session.quiz.clientData.totalQuestions == session.quiz.clientData.currentQuestionIndex) {
                //Update total score in profile
                session.profiles[session.settings.profileId].score += session.quiz.serverData.score;
                store = true;
            }
            else if (result.correct == true) {
                //store temporary score of quiz
                store = true;
            }

            if (store == true) {
                sessionUtils.storeSession(dbHelper, session, callback);
            }
            else {
                callback(null, dbHelper, session);
            }
        },

        //Check to save the profiles into the Admin as well - when quiz is finished
        function (dbHelper, session, callback) {
            if (session.quiz.clientData.totalQuestions == session.quiz.clientData.currentQuestionIndex) {
                sessionUtils.setAdminProfiles(dbHelper, session, callback);
            }
            else {
                callback(null, dbHelper);
            }
        },

        //Close the db
        function (dbHelper, callback) {
            dbHelper.close();
            callback(null, result);
        }

    ];

    async.waterfall(operations, function (err, result) {
        if (!err) {
            res.send(200, result);
        }
        else {
            res.send(err.status, err);
        }
    })
}

module.exports.nextQuestion = function (req, res, next) {
    var token = req.headers.authorization;
    var operations = [

        //Connect
        function (callback) {
            sessionUtils.getSession(token, callback);
        },

        //Pick a random subject from the avilable subjects in this quiz and prepare the query
        prepareQuestionCriteria,

        //Count number of questions excluding the previous questions
        getQuestionsCount,

        //Get the next question for the quiz
        getNextQuestion,

        //Sets the direction of the question
        setQuestionDirection,

        //Stores the session with the quiz in the db
        sessionUtils.storeSession,

        //Close the db
        function (dbHelper, session, callback) {
            dbHelper.close();
            callback(null, session.quiz.clientData);
        }
    ];

    async.waterfall(operations, function (err, quizClientData) {
        if (!err) {
            res.send(200, quizClientData);
        }
        else {
            res.send(err.status, err);
        }
    })
};

//Count questions collection in the selected subject (its topics)
function getQuestionsCount(dbHelper, session, questionCriteria, callback) {

    var questionsCollection = dbHelper.getCollection("Questions");
    questionsCollection.count(questionCriteria, function (err, count) {
        if (err) {
            callback(new excptions.GeneralError(500, "Error retrieving number of questions from database"));
            return;
        }

        callback(null, dbHelper, session, questionCriteria, count);
    })
};

//Get the next question
function getNextQuestion(dbHelper, session, questionCriteria, count, callback) {
    var skip = random.rnd(0, count - 1);
    var questionsCollection = dbHelper.getCollection("Questions");
    questionsCollection.findOne(questionCriteria, {skip: skip}, function (err, question) {
        if (err || !question) {
            callback(new excptions.GeneralError(500, "Error retrieving next question from database"));
            return;
        }

        session.quiz.clientData.currentQuestionIndex++;
        if (session.quiz.clientData.totalQuestions == session.quiz.clientData.currentQuestionIndex) {
            session.quiz.clientData.finished = true;
        }

        //Session is dynamic - perform some evals...
        if (question.vars) {

            //define the vars as "global" vars so they can be referenced by further evals
            for (var key in question.vars) {
                global[key] = eval(question.vars[key]);
            }

            //The question.text can include expressions like these: {{xp1}} {{xp2}} which need to be "evaled"
            question.text = question.text.replace(/\{\{(.*?)\}\}/g, function (match) {
                return eval(match.substring(2, match.length - 2));
            });

            //The answer.answer can include expressions like these: {{xp1}} {{xp2}} which need to be "evaled"
            question.answers.forEach(function (element, index, array) {
                element["text"] = element["text"].replace(/\{\{(.*?)\}\}/g, function (match) {
                    return eval(match.substring(2, match.length - 2));
                });
            })

            //delete global vars used for the evaluation
            for (var key in question.vars) {
                delete global[key];
            }
        }

        //Shuffle the answers
        question.answers = random.shuffle(question.answers);

        session.quiz.serverData.currentQuestion = question;

        session.quiz.clientData.currentQuestion = {"text": question.text, "answers": []};
        for (var i = 0; i < question.answers.length; i++) {
            session.quiz.clientData.currentQuestion.answers.push({"id": i + 1, "text": question.answers[i].text})
        }

        //Add this question id to the list of questions already asked during this quiz
        session.quiz.serverData.previousQuestions.push(question._id);

        callback(null, dbHelper, session);
    })
};

function setQuestionDirection(dbHelper, session, callback) {

    dal.getTopic(session.quiz.serverData.currentQuestion.topicId, function (err, topic) {
        if (err) {
            callback(err);
            return;
        }
        if (topic.forceDirection) {
            session.quiz.clientData.currentQuestion.direction = topic.forceDirection;
        }
        else {
            session.quiz.clientData.currentQuestion.direction = generalUtils.getDirectionByLanguage(session.profiles[session.settings.profileId].quizLanguage);
        }

        callback(null, dbHelper, session);

    })
};

function prepareQuestionCriteria(dbHelper, session, callback) {
    var randomSubject = random.rnd(0, session.quiz.subjects.length - 1);

    var questionCriteria = {
        "_id": {"$nin": session.quiz.serverData.previousQuestions},
        "topicId": {
            "$in": session.quiz.subjects[randomSubject].topics
        }
    };

    if (session.profiles[session.settings.profileId].yearOfBirth) {
        var currentYear = new Date().getFullYear();
        var age = currentYear - session.profiles[session.settings.profileId].yearOfBirth;
        if (age > 0) {
            questionCriteria.minAge = {$lte : age}
            questionCriteria.maxAge = {$gte : age}
        }
    }
    callback(null, dbHelper, session, questionCriteria);
}