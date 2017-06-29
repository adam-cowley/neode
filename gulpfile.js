var gulp = require('gulp'),
    mocha = require('gulp-mocha'),
    clear = require('clear');

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


gulp.task('tests', function() {
    clear();

    return gulp.src(['test/**/*.spec.js'])
        .pipe(mocha({
            reporter:'list',
            compilers:[
                'js:babel-core/register'
            ]
        }));
});
