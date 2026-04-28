public class UnsafeQuiz 
{
	public QuizType QuizType { get; set; }
	public List<QuizQuestion> Questions { get; set; } = new List<QuizQuestion>();
	public List<Guid>? CorrectAnswerIds { get; set; }
	public RubricConfig Rubric { get; set; } = new RubricConfig();
	}

	public enum QuizType
	{
		Tiered,
		Knowledge,
		Classification
		}

	public class QuizQuestion 
	{
		public Guid QuestionId { get; set; }

		public string QuestionText { get; set; }
		public List<UnsafeQuizAnswer> Answers { get; set; } = new List<UnsafeQuizAnswer>();
		public string Tip { get; set; }
		public string Explanation { get; set; }		

	}

	public class UnsafeQuizAnswer
	{
		public Guid QuestionId { get; set; }
		public Guid AnswerId { get; set; }
		public required string AnswerText { get; set; }
		public bool? IsCorrect { get; set; }
		public bool? AnswerSelected { get; set; }
		public int? PointValue { get; set; }
		public TypeOption? TypeOption { get; set; }
	}

	public class RubricConfig
	{
		public List<CriterionConfig> Criteria { get; set; } = new List<CriterionConfig>();
		
	}

public class CriterionConfig
{
	public Guid Id { get; set; }
	public string Label { get; set; }
	public string ResultText { get; set; }
	public string NextMove { get; set; }
	public int? Start { get; set; }
	public int? End { get; set; }
	public TypeOption? TypeOption { get; set; }
	public bool? IsMoreThanOne { get; set; }
	public string Image	{ get; set; }	
}

	public enum TypeOption
	{
		A, B, C, D, E, F, G, H, I, J
	}