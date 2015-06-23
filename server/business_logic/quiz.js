// Retrieve
var sessionUtils = require("../business_logic/session");
var async = require('async');
var excptions = require('../business_logic/exceptions');
var random = require('../business_logic/random');

module.exports.start = function (req, res, next) {
    var token = req.headers.authorization;
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

            session.quiz = quiz;

            callback(null, dbHelper, session)
        },

        //Count number of questions excluding the previous questions
        getQuestionsCount,

        //Get the next question for the quiz
        getNextQuestion,

        //Stores the session with the quiz in the db
        sessionUtils.storeSession,

        //Clears the "Correct" property from each answer before sending to client
        clearCorrectProperty,

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
            var answers = session.quiz.clientData.currentQuestion.answers;
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
            if (result.correct) {
                sessionUtils.storeSession(dbHelper, session, callback);
            }
            else {
                callback(null, dbHelper, session);
            }
        },

        //Close the db
        function (dbHelper, session, callback) {
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

        //Count number of questions excluding the previous questions
        getQuestionsCount,

        //Get the next question for the quiz
        getNextQuestion,

        //Stores the session with the quiz in the db
        sessionUtils.storeSession,

        //Clears the "Correct" property from each answer before sending to client
        clearCorrectProperty,

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

//Count questions collection
function getQuestionsCount(dbHelper, session, callback) {
    var questionsCollection = dbHelper.getCollection("Questions");
    questionsCollection.count({"_id": {"$nin": session.quiz.serverData.previousQuestions}}, function (err, count) {
        if (err) {
            callback(new excptions.GeneralError(500, "Error retrieving number of questions from database"));
            return;
        }
        ;
        callback(null, dbHelper, session, count);
    })
};

//Get the next question
function getNextQuestion(dbHelper, session, count, callback) {
    var skip = random.rnd(0, count-1);
    var questionsCollection = dbHelper.getCollection("Questions");
    questionsCollection.findOne({
        "_id": {"$nin": session.quiz.serverData.previousQuestions}
    }, {skip: skip}, function (err, question) {
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
                if (question.vars.hasOwnProperty(key)) {
                    global[key] = eval(question.vars[key]);
                }
            }

            //The question.text can include expressions like these: {{xp1}} {{xp2}} which need to be "evaled"
            question.text = question.text.replace(/\{\{(.*?)\}\}/g,function(match) {
                return eval(match.substring(2,match.length-2));
            });

            console.log("QuestionId: " + question.questionId);
            //The answer.answer can include expressions like these: {{xp1}} {{xp2}} which need to be "evaled"
            question.answers.forEach(function (element, index, array) {
                console.log("answer: " + element["answer"]);
                element["answer"] = element["answer"].replace(/\{\{(.*?)\}\}/g,function(match) {
                    return eval(match.substring(2,match.length-2));
                });
            })
        }

        session.quiz.clientData.currentQuestion = {"text": question.text, "answers": question.answers};

        //Add this question id to the list of questions already asked during this quiz
        session.quiz.serverData.previousQuestions.push(question._id);

        callback(null, dbHelper, session);
    })
};

function clearCorrectProperty(dbHelper, session, callback) {
    session.quiz.clientData.currentQuestion.answers.forEach(function (element, index, array) {
        delete element["correct"];
    })
    callback(null, dbHelper, session);
};