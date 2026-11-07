/**
This is some ugly looking jQuery that gets the job done
*/
!(function ($) {
  var ratings = {}

  function getNextMovie() {
    $.get(
      document.location.pathname + '/next?rated=' + Object.keys(ratings).join(','),
      function (res) {
        $('.film').attr('id', 'movie_' + res._id)
        $('.title').html(res.title)
        $('.poster').attr('src', res.poster)
        $('.plot').html(res.plot)
        $('.runtime').html(res.runtime)
        $('.year').html(res.year)
        $('.imdbRating').html(res.imdbRating)
      },
    )
  }

  function saveRating(id, rating) {
    ratings[id] = rating

    // If 10 films have been rated, take the user to the recommendation page
    if (Object.keys(ratings).length == 10) {
      document.location.href =
        document.location.pathname + '/results?ratings=' + JSON.stringify(ratings)

      return
    }

    // Else load the next movie
    getNextMovie()
  }

  $('.downvote').click(function (e) {
    e.preventDefault()

    var movie_id = $('.film').attr('id').replace('movie_', '')

    saveRating(movie_id, 2)
  })

  $('.upvote').click(function (e) {
    e.preventDefault()

    var movie_id = $('.film').attr('id').replace('movie_', '')

    saveRating(movie_id, 2)
  })
})(jQuery)
