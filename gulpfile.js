var gulp = require('gulp'),
    mocha = require('gulp-mocha'),
    clear = require('clear'),
    istanbul = require('gulp-istanbul'),
    isparta = require('isparta');

gulp.task('tdd', function() {
    return gulp.watch(['test/**/*.spec.js'])
        .on('change', function(file) {
            clear();

            return gulp.src(file.path)
                .pipe(mocha({
                    single: true,
                    reporter: 'list',
                    compilers: [
                        'js:babel-core/register'
                    ]
                }))
        });
});

gulp.task('pre-test', function() {
    return gulp.src(['src/**.js'])
        .pipe(istanbul({
            instrumenter: isparta.Instrumenter
        }))
        .pipe(istanbul.hookRequire());
});

gulp.task('tests', ['pre-test'], function() {
    clear();

    return gulp.src(['test/**/*.spec.js'])
        .pipe(mocha({
            compilers:[
                'js:babel-core/register'
            ]
        }))
        .pipe(istanbul.writeReports())
        .pipe(istanbul.enforceThresholds({thresholds: {global: 90}}));
});
